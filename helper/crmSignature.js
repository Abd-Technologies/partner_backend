// CRM → app backend signed calls (Nov 2026). Same scheme the CRM uses for
// its own read API (fithercrm webhookVerifier.js verifyAppRead):
//   x-webhook-timestamp: <unix s>   (must be within 5 minutes)
//   x-webhook-signature: sha256=HMAC(APP_WEBHOOK_SECRET,
//                          "<ts>.<METHOD>.<path+query>.<JSON body or empty>")
// Method + URL + body are signed, so a captured call can't be replayed or
// pointed at another ticket. On success the request acts as a sales rep
// (userType Customer_Support_Representative): list, view, reply — no status.
const crypto = require("crypto");
const ApiResponse = require("./ApiResponse");

const MAX_SKEW_SEC = 300;

// CRM_TO_APP_SECRET gives CRM → app calls their own key (set the same value
// on both servers); until it is set, the shared APP_WEBHOOK_SECRET is used.
const crmSecret = () => process.env.CRM_TO_APP_SECRET || process.env.APP_WEBHOOK_SECRET;

// Checks the signature only. { ok: true } or { status, message }.
function checkCrmSignature(req) {
  const secret = crmSecret();
  if (!secret) return { status: 503, message: "Not configured" };
  const ts = req.headers["x-webhook-timestamp"];
  const sig = String(req.headers["x-webhook-signature"] || "").replace(/^sha256=/, "");
  if (!ts || !sig) return { status: 403, message: "Missing signature" };
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() / 1000 - Number(ts)) > MAX_SKEW_SEC) {
    return { status: 403, message: "Signature expired" };
  }
  const hasBody = req.method !== "GET" && req.body && Object.keys(req.body).length > 0;
  const body = hasBody ? JSON.stringify(req.body) : "";
  const expected = crypto.createHmac("sha256", secret)
    .update(`${ts}.${req.method.toUpperCase()}.${req.originalUrl}.${body}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { status: 403, message: "Bad signature" };
  }
  return { ok: true };
}

function verifyCrmSigned(req, res, next) {
  const check = checkCrmSignature(req);
  if (!check.ok) return res.status(check.status).json(ApiResponse("0", check.message, {}));
  const hasBody = req.method !== "GET" && req.body && Object.keys(req.body).length > 0;
  const agent = hasBody && req.body.agent_name ? String(req.body.agent_name).slice(0, 60) : null;
  // The rep's own partner user id, when the CRM knows it (signed, so trusted):
  // e.g. a payment link is then credited to her, as from the admin portal.
  const pid = hasBody ? parseInt(req.body.partner_user_id, 10) : NaN;
  req.user = { id: Number.isInteger(pid) && pid > 0 ? pid : null, userType: "Customer_Support_Representative", crmAgentName: agent };
  next();
}

/**
 * verifyCrmInternal — for /internal/app-notify and /internal/support-ticket-update.
 * Accepts a signed request (as above). During the switch-over it also accepts
 * the old raw `x-internal-secret` header from CRM builds that don't sign yet,
 * compared timing-safe; set ALLOW_LEGACY_INTERNAL_SECRET=false once the CRM is
 * updated to turn that off. Sets req.crmVerified = true.
 */
function verifyCrmInternal(req, res, next) {
  if (req.headers["x-webhook-signature"]) {
    const check = checkCrmSignature(req);
    if (!check.ok) return res.status(check.status).json(ApiResponse("0", check.message, {}));
    req.crmVerified = true;
    return next();
  }
  if (process.env.ALLOW_LEGACY_INTERNAL_SECRET !== "false") {
    const secret = process.env.APP_WEBHOOK_SECRET || "";
    const provided = String(req.headers["x-internal-secret"] || "");
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    if (secret && a.length === b.length && crypto.timingSafeEqual(a, b)) {
      console.warn(`[crmInternal] ${req.originalUrl}: legacy x-internal-secret used — update the CRM to signed calls`);
      req.crmVerified = true;
      return next();
    }
  }
  return res.status(403).json(ApiResponse("0", "Forbidden", {}));
}

module.exports = { verifyCrmSigned, verifyCrmInternal, checkCrmSignature };
