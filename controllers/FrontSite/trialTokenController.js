'use strict';

/**
 * trialTokenController.js — Trial deep-link token management for sales reps.
 *
 * ─── Endpoints ────────────────────────────────────────────────────────────────
 *   POST   /admin/create-trial-token          (validateToken required)
 *   GET    /admin/my-trial-tokens             (validateToken required)
 *   DELETE /admin/revoke-trial-token/:token   (validateToken required)
 *
 * ─── Deep-link format ─────────────────────────────────────────────────────────
 *   https://backend.thefither.com/trial?token=<token>
 *
 *   The Flutter AppLinkHandler detects any URI containing "trial" with a
 *   "token" query param, calls /trial/validate-token, then /trial/start.
 *   AndroidManifest registers backend.thefither.com as a verified domain.
 *
 * ─── Token lifecycle ──────────────────────────────────────────────────────────
 *   issued   → link created, not yet opened
 *   used     → user tapped link and started trial (set by trialController.js)
 *   expired  → expiresAt < now (checked lazily on validate-token)
 *   revoked  → rep or admin manually killed the link
 */

const crypto       = require('crypto');
const { Op }       = require('sequelize');
const { TrialToken } = require('../../models');
const ApiResponse  = require('../../helper/ApiResponse');

// ─── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_DAYS = 7;
const MAX_EXPIRY_DAYS     = 30;
// Always use the production domain — this is the verified Android App Link domain.
// It is intentionally NOT driven by an env var: the deep link must match the domain
// in AndroidManifest.xml regardless of which server (local or prod) handles the API calls.
const DEEP_LINK_BASE = 'https://backend.thefither.com';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generates a 12-character URL-safe token, e.g. "K7m3qR2x9Abc".
 * Retries up to 5 times to handle the vanishingly rare UUID collision.
 */
async function generateUniqueToken() {
  for (let i = 0; i < 5; i++) {
    const candidate = crypto
      .randomBytes(9)
      .toString('base64')
      .replace(/[/+=]/g, '')
      .slice(0, 12);

    const existing = await TrialToken.findOne({ where: { token: candidate } });
    if (!existing) return candidate;
  }
  return null;
}

function buildDeepLink(token) {
  return `${DEEP_LINK_BASE}/trial?token=${token}`;
}

function serializeToken(row) {
  return {
    id:          row.id,
    token:       row.token,
    deepLink:    buildDeepLink(row.token),
    phone:       row.issuedForPhone  || null,
    email:       row.issuedForEmail  || null,
    status:      row.status,
    expiresAt:   row.expiresAt,
    usedAt:      row.usedAt          || null,
    createdAt:   row.createdAt,
  };
}

// ─── 1. Create a trial token ─────────────────────────────────────────────────

/**
 * POST /admin/create-trial-token
 *
 * Body (all optional):
 *   phone        {string}  — who the link is for (display only, not validated)
 *   email        {string}  — alternative identifier
 *   expiresInDays {number} — default 7, max 30
 *
 * Returns: { token, deepLink, expiresAt, phone, email, status }
 */
async function createTrialToken(req, res) {
  try {
    const repId = req.user?.id || null;
    const phone = req.body.phone  ? String(req.body.phone).trim()  : null;
    const email = req.body.email  ? String(req.body.email).trim()  : null;

    let expiresInDays = parseInt(req.body.expiresInDays, 10);
    if (isNaN(expiresInDays) || expiresInDays < 1) expiresInDays = DEFAULT_EXPIRY_DAYS;
    if (expiresInDays > MAX_EXPIRY_DAYS)           expiresInDays = MAX_EXPIRY_DAYS;

    const token = await generateUniqueToken();
    if (!token) {
      return res.json(ApiResponse('0', 'Could not generate unique token — please retry', {}));
    }

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const row = await TrialToken.create({
      token,
      issuedForPhone:  phone,
      issuedForEmail:  email,
      referrerUserId:  repId,
      expiresAt,
      status:          'issued',
    });

    console.log(`[trial-token] created token=${token} by rep=${repId} for phone=${phone}`);

    return res.json(ApiResponse('1', 'Trial link created', serializeToken(row)));
  } catch (err) {
    console.error('[trial-token] createTrialToken error:', err);
    return res.json(ApiResponse('0', 'Server error', {}));
  }
}

// ─── 2. List tokens created by this rep ──────────────────────────────────────

/**
 * GET /admin/my-trial-tokens
 *
 * Query params (all optional):
 *   page   {number}  — 1-based, default 1
 *   limit  {number}  — default 20, max 100
 *   status {string}  — filter by status (issued|used|expired|revoked)
 *
 * Returns: { tokens: [...], total, page, limit }
 */
async function listMyTrialTokens(req, res) {
  try {
    const repId  = req.user?.id;
    const page   = Math.max(1, parseInt(req.query.page,  10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const where = { referrerUserId: repId };
    if (req.query.status) {
      const allowed = ['issued', 'used', 'expired', 'revoked'];
      if (allowed.includes(req.query.status)) {
        where.status = req.query.status;
      }
    }

    // Lazily expire tokens that are past their expiresAt but still marked "issued"
    await TrialToken.update(
      { status: 'expired' },
      {
        where: {
          referrerUserId: repId,
          status:         'issued',
          expiresAt:      { [Op.lt]: new Date() },
        },
      }
    );

    const { count, rows } = await TrialToken.findAndCountAll({
      where,
      order:  [['createdAt', 'DESC']],
      limit,
      offset,
      attributes: ['id', 'token', 'issuedForPhone', 'issuedForEmail',
                   'status', 'expiresAt', 'usedAt', 'createdAt'],
    });

    return res.json(ApiResponse('1', 'OK', {
      tokens: rows.map(serializeToken),
      total:  count,
      page,
      limit,
    }));
  } catch (err) {
    console.error('[trial-token] listMyTrialTokens error:', err);
    return res.json(ApiResponse('0', 'Server error', {}));
  }
}

// ─── 3. Revoke a token ───────────────────────────────────────────────────────

/**
 * DELETE /admin/revoke-trial-token/:token
 *
 * Reps can only revoke tokens they created. Admins can revoke any.
 * Cannot revoke already-used tokens (the trial has started — nothing to cancel).
 */
async function revokeTrialToken(req, res) {
  try {
    const repId     = req.user?.id;
    const tokenStr  = req.params.token;

    if (!tokenStr) {
      return res.json(ApiResponse('0', 'Token is required', {}));
    }

    const row = await TrialToken.findOne({ where: { token: tokenStr } });
    if (!row) {
      return res.json(ApiResponse('0', 'Token not found', {}));
    }

    // Ownership check — reps can only revoke their own tokens.
    // Allow if referrerUserId matches OR if the caller is an Admin userType.
    if (row.referrerUserId !== repId && req.user?.userType === 'User') {
      return res.json(ApiResponse('0', 'Not authorised to revoke this token', {}));
    }

    if (row.status === 'used') {
      return res.json(ApiResponse('0', 'Token already used — trial has started', {}));
    }
    if (row.status === 'revoked') {
      return res.json(ApiResponse('0', 'Token is already revoked', {}));
    }

    row.status = 'revoked';
    await row.save();

    console.log(`[trial-token] revoked token=${tokenStr} by rep=${repId}`);
    return res.json(ApiResponse('1', 'Token revoked', serializeToken(row)));
  } catch (err) {
    console.error('[trial-token] revokeTrialToken error:', err);
    return res.json(ApiResponse('0', 'Server error', {}));
  }
}

module.exports = { createTrialToken, listMyTrialTokens, revokeTrialToken };
