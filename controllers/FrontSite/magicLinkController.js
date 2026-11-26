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

// Approval rules live in helper/slipRules.js (account, reference, date, amount).

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

// Sec pass 1 (Oct 2026): a rep can't create a link for any amount she
// likes. paidAmount must be > 0 and inside the plan's real price range:
// from 50% of its lowest price up to its highest price. Pakistan (PKR)
// prices are used when the plan has them, so a USD row doesn't drag the
// floor down. A plan with no prices (or no plan) is Admin only.
const MIN_PAID_SHARE = 0.5;

const toAmount = (v) => {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

async function planPriceRange(planId) {
  if (!planId) return null;
  const rows = await Price.findAll({
    where: { planId },
    attributes: ['id', 'priceAmount', 'countryId'],
    include: [{ association: 'country', attributes: ['code', 'currency'], required: false }],
  });
  const isPk = (r) => {
    const c = r.country || {};
    return String(c.code || '').trim().toUpperCase() === 'PK' ||
      String(c.currency || '').trim().toUpperCase() === 'PKR';
  };
  const pk = rows.filter(isPk);
  const use = pk.length ? pk : rows;
  const amounts = use.map((r) => toAmount(r.priceAmount)).filter((n) => n > 0);
  if (!amounts.length) return null;
  return { min: Math.min(...amounts), max: Math.max(...amounts) };
}

async function callerIsAdmin(req) {
  const roles = require('../../helper/roles');
  if (req.authUser) return roles.isAdmin(req.authUser);
  const me = req.user && req.user.id
    ? await User.findByPk(req.user.id, { attributes: ['id', 'userType'] })
    : null;
  return roles.isAdmin(me);
}

// ─── 1. Create a magic link (rep-side) ────────────────────────────

async function createLink(req, res) {
  try {
    const {
      PlanId,
      PriceDurationId,
      phone,
      email,
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
    const paidNum = toAmount(paidAmount);
    const listNum = toAmount(listPrice);
    if (!(paidNum > 0) || !(listNum > 0)) {
      return res.status(200).json(ApiResponse('0', 'Please enter a paid amount greater than 0.', {}));
    }
    if (paidNum > listNum) {
      return res.status(200).json(ApiResponse('0', 'paidAmount cannot exceed listPrice', {}));
    }
    {
      const range = await planPriceRange(PlanId);
      if (!range) {
        if (!(await callerIsAdmin(req))) {
          return res.status(200).json(ApiResponse('0',
            'This package has no price set yet, so only the Fit Her admin can make a link for it.', {}));
        }
      } else {
        const floor = Math.ceil(range.min * MIN_PAID_SHARE);
        if (paidNum < floor || paidNum > range.max) {
          return res.status(200).json(ApiResponse('0',
            `The amount must be between Rs ${floor} and Rs ${range.max} for this package. ` +
            'For a bigger discount, please ask the Fit Her admin.', { minAmount: floor, maxAmount: range.max }));
        }
      }
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
      // Optional: her signup email, so the plan also finds her by email.
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
        ? String(email).trim().toLowerCase().slice(0, 160)
        : null,
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

// ─── 3. Redeem: one slip against one link (shared) ────────────────
//
// Used by the public link page (redeemLink) and by the CRM when she sends
// the slip on WhatsApp (redeemFromCrm). Nov 2026:
//   - userId is only ever a TRUSTED id (a verified login, or the CRM's signed
//     call), never a number typed into the form.
//   - A slip that passes every check while she has no app account yet is kept
//     as "approved, waiting for her signup"; helper/paymentClaims.js starts
//     her plan the moment she signs up with that phone.
//   - The amount is checked against the link's amount (slipRules).

const fail = (code, message, data = {}) => ({ ok: false, code, message, data });

async function linkUsable(link) {
  if (!link) return fail(404, 'Link not found');
  if (link.status === 'redeemed') return fail(200, 'Link has already been redeemed');
  if (link.status === 'cancelled') return fail(200, 'Link has been cancelled');
  if (new Date(link.expiresAt) < new Date()) {
    link.status = 'expired';
    await link.save();
    return fail(200, 'Link has expired');
  }
  return null;
}

async function redeemWithSlip(link, { imagePath, userId = null, payerName = null, payerRelationship = null }) {
  const bad = await linkUsable(link);
  if (bad) return bad;
  if (payerRelationship && !ALLOWED_RELATIONSHIPS.includes(String(payerRelationship).toLowerCase())) {
    return fail(200, `payerRelationship must be one of: ${ALLOWED_RELATIONSHIPS.join(', ')}`);
  }
  const ownerId = userId || link.UserId || null;

  let ocrResult = null;
  try {
    ocrResult = await extractSlipData(imagePath, { amount: link.paidAmount });
  } catch (err) {
    console.warn('OCR failed (non-fatal):', err.message);
  }

  // Same transaction / reference used before?
  if (ocrResult?.refNumber) {
    const dup = await PlanImage.findOne({
      attributes: ['id', 'UserId', 'createdAt', 'verifyStatus'],
      where: { ocrTransactionId: ocrResult.refNumber },
    });
    if (dup && dup.verifyStatus === 'rejected') {
      return fail(200, 'This payment slip was not approved before, so it can\'t be used again. Please contact support.', { duplicateOf: dup.id, rejected: true });
    }
    if (dup) {
      console.warn(`⚠️ Duplicate transaction ID: ${ocrResult.refNumber} already used by PlanImage id=${dup.id}`);
      return fail(200, 'This payment slip has already been used. Each transaction can only be redeemed once. Contact support if you believe this is an error.', { duplicateOf: dup.id });
    }
  }

  let passed = false;
  let approvalReason = null;
  let slipDecision = null;
  try {
    slipDecision = await require('../../helper/slipRules').decideSlip(ocrResult, link.paidAmount);
    passed = slipDecision.autoApproved;
    approvalReason = slipDecision.reason;
  } catch (e) {
    console.error('[slipRules] decide failed:', e.message);
    approvalReason = 'Slip check failed — admin review';
  }
  const waitingForSignup = passed && !ownerId;

  const planImage = await PlanImage.create({
    PlanId:             link.PlanId,
    UserId:             ownerId,
    PriceDurationId:    link.PriceDurationId,
    image:              imagePath,
    price:              link.paidAmount,
    status:             true,
    listPrice:          link.listPrice,
    paidAmount:         ocrResult?.amount && passed ? ocrResult.amount : link.paidAmount,
    discountAmount:     link.discountAmount,
    discountReason:     link.discountReason,
    uploadedByRepId:    link.createdByRepId,
    uploadSource:       'magic_link',
    magicPaymentLinkId: link.id,
    payerName:          payerName || link.payerName || null,
    payerRelationship:  (payerRelationship || link.payerRelationship || null)
                          ? String(payerRelationship || link.payerRelationship).toLowerCase() : null,
    ocrData: {
      ...(ocrResult ? {
        amount: ocrResult.amount, amounts: ocrResult.amounts, date: ocrResult.date, bank: ocrResult.bank,
        sender: ocrResult.sender, receiver: ocrResult.receiver, receiverVerified: ocrResult.receiverVerified,
        refNumber: ocrResult.refNumber, rawText: ocrResult.rawText?.slice(0, 1000),
      } : {}),
      autoApproved: passed,
      approvalReason: waitingForSignup ? `${approvalReason} — plan starts when she signs up` : approvalReason,
      waitingForSignup,
      payerPhone: link.phone || null,
      crmLeadId: link.crmLeadId || null,
      account: slipDecision?.account || null,
      slipDate: slipDecision?.slipDate || null,
      checks: slipDecision?.checks || null,
    },
    ocrConfidence:    ocrResult?.confidence || null,
    ocrAmount:        ocrResult?.amount     || null,
    ocrBank:          ocrResult?.bank       || null,
    ocrDate:          ocrResult?.date       || null,
    ocrSender:        ocrResult?.sender     || null,
    ocrReceiver:      ocrResult?.receiver   || null,
    ocrTransactionId: ocrResult?.refNumber  || null,
  });

  // Her account exists and the slip passed: start the plan now.
  let activation = null;
  let autoApproved = false;
  if (passed && ownerId && planImage.PlanId) {
    try {
      activation = await applyPlanApproval(planImage, { approvalSource: 'auto' });
      autoApproved = !!activation.ok;
      if (!activation.ok) approvalReason = `Auto-approve failed: ${activation.error} — admin review required`;
    } catch (err) {
      console.error('Auto-activation error:', err);
      approvalReason = 'Auto-approve failed — admin review required';
    }
  }
  if (!autoApproved && !waitingForSignup) {
    require('../../helper/paymentVerify').notifySlipForReview(planImage, approvalReason).catch(() => {});
  }

  link.status = 'redeemed';
  link.redeemedAt = new Date();
  link.redeemedPlanImageId = planImage.id;
  if (ownerId && !link.UserId) link.UserId = ownerId;
  await link.save();

  const verificationStatus = autoApproved ? 'verified' : waitingForSignup ? 'verified_waiting_signup' : 'pending_review';
  const message = autoApproved
    ? 'Payment verified — your plan is now active!'
    : waitingForSignup
      ? 'Payment verified — sign up in the Fit Her app with this number and your plan starts.'
      : 'Payment slip received. Our team is verifying and you will be notified shortly.';
  return {
    ok: true,
    message,
    data: {
      planImageId: planImage.id,
      linkStatus: link.status,
      autoApproved,
      verificationStatus,
      reason: approvalReason,
      userPlanActivated: !!activation?.ok,
      userPlanId: activation?.userPlanId || null,
      ocrSummary: ocrResult ? {
        confidence: ocrResult.confidence, amount: ocrResult.amount, bank: ocrResult.bank, date: ocrResult.date,
        receiver: ocrResult.receiver, receiverVerified: ocrResult.receiverVerified, refNumber: ocrResult.refNumber,
      } : null,
    },
  };
}

/** Who is signed in on this request, if anyone (a verified app token only). */
async function trustedUserId(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const { user } = await require('../../helper/authToken').verifyAccess(token);
    return user ? user.id : null;
  } catch (_) {
    return null;
  }
}

// Public page / in-app screen (multipart, field "slip").
async function redeemLink(req, res) {
  try {
    const link = await MagicPaymentLink.findOne({ where: { token: req.params.token } });
    if (!req.file) {
      const bad = await linkUsable(link);
      if (bad) return res.status(bad.code).json(ApiResponse('0', bad.message, bad.data));
      return res.status(200).json(ApiResponse('0', 'Payment slip image is required', {}));
    }
    // userId from the form is NOT trusted any more: only a verified login.
    if (req.body.userId) console.warn(`[magic-link] ignoring userId=${req.body.userId} from the form; using the login instead`);
    const out = await redeemWithSlip(link, {
      imagePath: req.file.path.replace(/\\/g, '/'),
      userId: await trustedUserId(req),
      payerName: req.body.payerName,
      payerRelationship: req.body.payerRelationship,
    });
    if (!out.ok) return res.status(out.code).json(ApiResponse('0', out.message, out.data));
    return res.json(ApiResponse('1', out.message, out.data));
  } catch (err) {
    console.error('redeemLink error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

// The CRM, signed (routes/internal.js): she sent the slip on WhatsApp.
//   { token, image_base64, mime?, app_user_id? }
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
async function redeemFromCrm(req, res) {
  try {
    const { token, image_base64: b64, mime = 'image/jpeg', app_user_id: appUserId } = req.body || {};
    if (!token || !b64) return res.status(400).json(ApiResponse('0', 'token and image_base64 are required', {}));
    const ext = MIME_EXT[String(mime).toLowerCase()];
    if (!ext) return res.status(400).json(ApiResponse('0', `Not an image: ${mime}`, {}));
    const buf = Buffer.from(String(b64), 'base64');
    if (!buf.length || buf.length > 8 * 1024 * 1024) return res.status(400).json(ApiResponse('0', 'Image is empty or bigger than 8 MB', {}));
    const link = await MagicPaymentLink.findOne({ where: { token: String(token) } });
    const file = path.join(slipUploadDir, `slip-wa-${Date.now()}-${Math.floor(Math.random() * 1e9)}${ext}`);
    fs.writeFileSync(file, buf);
    let userId = null;
    if (appUserId) {
      const u = await User.findOne({ where: { id: appUserId }, attributes: ['id'] });
      userId = u ? u.id : null;
    }
    if (!userId) {
      // Not linked in the CRM yet — she may still have an account: the link's
      // phone (last 10 digits) or email. Only an unambiguous single match.
      userId = await require('../../helper/paymentClaims').findAccountFor(link);
    }
    const out = await redeemWithSlip(link, { imagePath: file.replace(/\\/g, '/'), userId });
    if (!out.ok) return res.status(out.code === 404 ? 404 : 200).json(ApiResponse('0', out.message, out.data));
    return res.json(ApiResponse('1', out.message, out.data));
  } catch (err) {
    console.error('redeemFromCrm error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

module.exports = {
  createLink,
  getLink,
  redeemLink,
  redeemFromCrm,
  redeemWithSlip,
  slipUpload,
};
