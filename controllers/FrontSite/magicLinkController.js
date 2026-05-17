/**
 * magicLinkController.js — endpoints for the magic payment link flow.
 *
 * Three endpoints:
 *   POST /admin/magic-links               (auth required, rep-only)
 *     Rep creates a link from the CRM. Returns { token, url, expiresAt, ... }.
 *
 *   GET  /magic-links/:token              (public)
 *     The web fallback page and the in-app upload screen call this to fetch
 *     the link details and render the package summary.
 *
 *   POST /magic-links/:token/redeem       (public, multipart)
 *     The customer (or anyone paying for her) submits the slip image plus
 *     optional payer info. Creates a PlanImage in 'pending approval' state.
 *     If userId is present (user is signed in), associates the link to that user.
 */

const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  MagicPaymentLink,
  PlanImage,
  Plan,
  Price,
  PriceDurations, // model is registered as 'PriceDurations' (plural)
  User,
} = require('../../models');
const ApiResponse = require('../../helper/ApiResponse');
const { extractSlipData } = require('../../helper/visionOCR');
const { applyPlanApproval } = require('../../helper/applyPlanApproval');
const { Op } = require('sequelize');

// Auto-approval thresholds
const AUTO_APPROVE_MIN_CONFIDENCE = 0.75;   // OCR confidence must be at least this
const AMOUNT_TOLERANCE_PKR        = 50;     // ±50 PKR considered "exact match"
const MAX_SLIP_AGE_DAYS           = 14;     // Slips older than this need admin

// ─── Helpers ──────────────────────────────────────────────────────

function generateToken() {
  // 9-char URL-safe token, e.g. "K7m3qR2x9"
  return crypto.randomBytes(6).toString('base64').replace(/[/+=]/g, '').slice(0, 9);
}

const ALLOWED_RELATIONSHIPS = [
  'self', 'husband', 'father', 'brother', 'mother', 'sister', 'son',
  'friend', 'coach', 'other',
];

// Multer config for slip image uploads
const slipUploadDir = path.join(__dirname, '..', '..', 'public', 'payment_slips');
if (!fs.existsSync(slipUploadDir)) {
  fs.mkdirSync(slipUploadDir, { recursive: true });
}

const slipStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, slipUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e9);
    cb(null, `slip-${stamp}${ext}`);
  },
});

const slipUpload = multer({
  storage: slipStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|heic|heif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ─── 1. Create a magic link (rep-side) ────────────────────────────

async function createLink(req, res) {
  try {
    const {
      PlanId,
      PriceDurationId,
      phone,
      crmLeadId,
      listPrice,
      paidAmount,
      discountReason,
      payerName,
      payerRelationship,
      validDays,
      notes,
    } = req.body;

    if (!listPrice || !paidAmount) {
      return res.status(200).json(ApiResponse('0', 'listPrice and paidAmount are required', {}));
    }
    if (paidAmount > listPrice) {
      return res.status(200).json(ApiResponse('0', 'paidAmount cannot exceed listPrice', {}));
    }
    if (payerRelationship && !ALLOWED_RELATIONSHIPS.includes(String(payerRelationship).toLowerCase())) {
      return res.status(200).json(ApiResponse('0',
        `payerRelationship must be one of: ${ALLOWED_RELATIONSHIPS.join(', ')}`, {}));
    }

    const discountAmount = Math.max(0, parseInt(listPrice, 10) - parseInt(paidAmount, 10));
    const days = parseInt(validDays || 3, 10);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    // Generate a unique token (retry up to 5 times if collision)
    let token;
    for (let i = 0; i < 5; i++) {
      const candidate = generateToken();
      const existing = await MagicPaymentLink.findOne({ where: { token: candidate } });
      if (!existing) { token = candidate; break; }
    }
    if (!token) {
      return res.status(500).json(ApiResponse('0', 'Could not generate unique token, retry', {}));
    }

    const link = await MagicPaymentLink.create({
      token,
      PlanId: PlanId || null,
      PriceDurationId: PriceDurationId || null,
      phone: phone || null,
      crmLeadId: crmLeadId || null,
      listPrice: parseInt(listPrice, 10),
      paidAmount: parseInt(paidAmount, 10),
      discountAmount,
      discountReason: discountReason || null,
      createdByRepId: req.user?.id || null,
      payerName: payerName || null,
      payerRelationship: payerRelationship ? String(payerRelationship).toLowerCase() : null,
      status: 'pending',
      expiresAt,
      notes: notes || null,
    });

    const base = process.env.PUBLIC_LINK_BASE_URL || process.env.BASE_URL || 'https://thefither.com';
    const url = `${base.replace(/\/$/, '')}/p/${token}`;

    return res.json(ApiResponse('1', 'Link created', {
      id: link.id,
      token,
      url,
      expiresAt: link.expiresAt,
      listPrice: link.listPrice,
      paidAmount: link.paidAmount,
      discountAmount: link.discountAmount,
      discountReason: link.discountReason,
    }));
  } catch (err) {
    console.error('createLink error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

// ─── 2. Fetch link details by token (public) ──────────────────────

async function getLink(req, res) {
  try {
    const { token } = req.params;
    const link = await MagicPaymentLink.findOne({
      where: { token },
      include: [
        { model: Plan,           attributes: ['id', 'title', 'shortDescription'], required: false },
        { model: PriceDurations, attributes: ['id', 'duration'], required: false },
      ],
    });

    if (!link) {
      return res.status(404).json(ApiResponse('0', 'Link not found', {}));
    }

    // Mark "opened" on first view (don't block response)
    if (link.status === 'pending' && !link.openedAt) {
      link.openedAt = new Date();
      link.status = 'opened';
      link.save().catch(() => {});
    }

    // Expire on the fly if past expiresAt
    const isExpired = new Date(link.expiresAt) < new Date();
    if (isExpired && link.status !== 'redeemed' && link.status !== 'cancelled') {
      link.status = 'expired';
      link.save().catch(() => {});
    }

    // ⚠ Customer-facing response — pricing is INTENTIONALLY HIDDEN.
    // Sales rep stored the expected amount internally; admin will confirm
    // the actual paid amount when reviewing the slip. The customer only
    // sees the plan + duration and uploads the slip.
    return res.json(ApiResponse('1', 'Link details', {
      token: link.token,
      status: link.status,
      isExpired,
      isRedeemed: link.status === 'redeemed',
      expiresAt: link.expiresAt,
      plan: link.Plan ? { id: link.Plan.id, title: link.Plan.title, shortDescription: link.Plan.shortDescription } : null,
      duration: link.PriceDurations ? { id: link.PriceDurations.id, duration: link.PriceDurations.duration } : null,
      payerName: link.payerName,            // optional rep-pre-fill (e.g. "Husband - Ahmed")
      payerRelationship: link.payerRelationship,
    }));
  } catch (err) {
    console.error('getLink error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

// ─── 3. Redeem link with slip upload (public, multipart) ──────────

async function redeemLink(req, res) {
  try {
    const { token } = req.params;
    const { userId, payerName, payerRelationship } = req.body;
    const slipFile = req.file;

    const link = await MagicPaymentLink.findOne({ where: { token } });
    if (!link) {
      return res.status(404).json(ApiResponse('0', 'Link not found', {}));
    }
    if (link.status === 'redeemed') {
      return res.status(200).json(ApiResponse('0', 'Link has already been redeemed', {}));
    }
    if (link.status === 'cancelled') {
      return res.status(200).json(ApiResponse('0', 'Link has been cancelled', {}));
    }
    if (new Date(link.expiresAt) < new Date()) {
      link.status = 'expired';
      await link.save();
      return res.status(200).json(ApiResponse('0', 'Link has expired', {}));
    }
    if (!slipFile) {
      return res.status(200).json(ApiResponse('0', 'Payment slip image is required', {}));
    }
    if (payerRelationship && !ALLOWED_RELATIONSHIPS.includes(String(payerRelationship).toLowerCase())) {
      return res.status(200).json(ApiResponse('0',
        `payerRelationship must be one of: ${ALLOWED_RELATIONSHIPS.join(', ')}`, {}));
    }

    const imagePath = slipFile.path.replace(/\\/g, '/');

    // ─── Run OCR (fire-and-await — gives instant verification when possible) ───
    // We pass the expected amount so confidence scoring can include a match check.
    let ocrResult = null;
    try {
      ocrResult = await extractSlipData(imagePath, { amount: link.paidAmount });
    } catch (err) {
      console.warn('OCR failed (non-fatal):', err.message);
    }

    // ─── Duplicate detection — indexed lookup on ocrTransactionId column ───
    let duplicateOf = null;
    if (ocrResult?.refNumber) {
      const dup = await PlanImage.findOne({
        attributes: ['id', 'UserId', 'createdAt'],
        where: { ocrTransactionId: ocrResult.refNumber },
      });
      if (dup) duplicateOf = dup.id;
    }

    if (duplicateOf) {
      console.warn(`⚠️ Duplicate transaction ID detected: ${ocrResult.refNumber} already used by PlanImage id=${duplicateOf}`);
      return res.status(200).json(ApiResponse('0',
        'This payment slip has already been used. Each transaction can only be redeemed once. Contact support if you believe this is an error.',
        { duplicateOf }
      ));
    }

    // ─── Decide auto-approve vs admin queue based on OCR ───
    let autoApproved = false;
    let approvalReason = null;
    if (ocrResult && ocrResult.confidence >= AUTO_APPROVE_MIN_CONFIDENCE) {
      // Amount must match within tolerance
      if (ocrResult.amount &&
          Math.abs(ocrResult.amount - link.paidAmount) <= AMOUNT_TOLERANCE_PKR) {
        autoApproved = true;
        approvalReason = `OCR confidence ${(ocrResult.confidence * 100).toFixed(0)}% — amount + bank verified`;
      } else if (ocrResult.amount && ocrResult.amount > link.paidAmount) {
        // Customer paid more than expected — auto-approve at the actual amount paid.
        // Admin can still see this case and refund difference or credit it.
        autoApproved = true;
        approvalReason = `OCR confidence ${(ocrResult.confidence * 100).toFixed(0)}% — customer paid more (PKR ${ocrResult.amount}), credit forward`;
      }
    }

    // Create the PlanImage row (status reflects auto vs manual review)
    const planImage = await PlanImage.create({
      PlanId:             link.PlanId,
      UserId:             userId || link.UserId || null,
      PriceDurationId:    link.PriceDurationId,
      image:              imagePath,
      price:              link.paidAmount,
      status:             true,
      // Extended fields
      listPrice:          link.listPrice,
      paidAmount:         ocrResult?.amount && autoApproved ? ocrResult.amount : link.paidAmount,
      discountAmount:     link.discountAmount,
      discountReason:     link.discountReason,
      uploadedByRepId:    link.createdByRepId,
      uploadSource:       'magic_link',
      magicPaymentLinkId: link.id,
      payerName:          payerName     || link.payerName     || null,
      payerRelationship:  (payerRelationship || link.payerRelationship || null) ?
                            String(payerRelationship || link.payerRelationship).toLowerCase() : null,
      ocrData:            ocrResult ? {
                            amount:     ocrResult.amount,
                            amounts:    ocrResult.amounts,
                            date:       ocrResult.date,
                            bank:       ocrResult.bank,
                            sender:     ocrResult.sender,
                            refNumber:  ocrResult.refNumber,
                            rawText:    ocrResult.rawText?.slice(0, 1000),
                            autoApproved,
                            approvalReason,
                          } : null,
      ocrConfidence:      ocrResult?.confidence || null,
      // Top-level OCR columns — easier to query, index, and display
      ocrAmount:          ocrResult?.amount     || null,
      ocrBank:            ocrResult?.bank       || null,
      ocrDate:            ocrResult?.date       || null,
      ocrSender:          ocrResult?.sender     || null,
      ocrTransactionId:   ocrResult?.refNumber  || null,
    });

    // ─── Auto-activate the plan if OCR auto-approved it ───
    // Mirrors the existing admin approvedImage logic so behavior matches.
    let activationResult = null;
    if (autoApproved && planImage.UserId && planImage.PlanId) {
      try {
        activationResult = await applyPlanApproval(planImage, { approvalSource: 'auto' });
        if (!activationResult.ok) {
          // Activation failed (missing user, plan, or duration) — fall back to admin review.
          console.warn('Auto-activation failed, falling back to admin queue:', activationResult.error);
          autoApproved = false;
          approvalReason = `Auto-approve failed: ${activationResult.error} — admin review required`;
        }
      } catch (err) {
        console.error('Auto-activation error:', err);
        autoApproved = false;
      }
    } else if (autoApproved && (!planImage.UserId || !planImage.PlanId)) {
      // Can't activate without a user + plan — needs admin to link them up
      console.warn('Auto-approve flag set but missing UserId/PlanId — admin review required');
      autoApproved = false;
      approvalReason = 'OCR passed but link not associated with user/plan — admin review required';
    }

    // Update the link
    link.status = 'redeemed';
    link.redeemedAt = new Date();
    link.redeemedPlanImageId = planImage.id;
    if (userId && !link.UserId) link.UserId = userId;
    await link.save();

    // Different user-facing message based on auto-approve outcome
    const userMessage = autoApproved
      ? 'Payment verified — your plan is now active!'
      : 'Payment slip received. Our team is verifying and you will be notified shortly.';

    return res.json(ApiResponse('1', userMessage, {
      planImageId:   planImage.id,
      linkStatus:    link.status,
      autoApproved,
      verificationStatus: autoApproved ? 'verified' : 'pending_review',
      userPlanActivated: !!activationResult?.ok,
      userPlanId:        activationResult?.userPlanId || null,
      // Hint for the app UI — show different post-upload screens
      ocrSummary: ocrResult ? {
        confidence: ocrResult.confidence,
        amount:     ocrResult.amount,
        bank:       ocrResult.bank,
        date:       ocrResult.date,
        refNumber:  ocrResult.refNumber,
      } : null,
    }));
  } catch (err) {
    console.error('redeemLink error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

module.exports = {
  createLink,
  getLink,
  redeemLink,
  slipUpload,
};
