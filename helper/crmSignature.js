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

function verifyCrmSigned(req, res, next) {
  const secret = process.env.APP_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json(ApiResponse("0", "Not configured", {}));
  const ts = req.headers["x-webhook-timestamp"];
  const sig = String(req.headers["x-webhook-signature"] || "").replace(/^sha256=/, "");
  if (!ts || !sig) return res.status(403).json(ApiResponse("0", "Missing signature", {}));
  if (!Number.isFinite(Number(ts)) || Math.abs(Date.now() / 1000 - Number(ts)) > MAX_SKEW_SEC) {
    return res.status(403).json(ApiResponse("0", "Signature expired", {}));
  }
  const hasBody = req.method !== "GET" && req.body && Object.keys(req.body).length > 0;
  const body = hasBody ? JSON.stringify(req.body) : "";
  const expected = crypto.createHmac("sha256", secret)
    .update(`${ts}.${req.method.toUpperCase()}.${req.originalUrl}.${body}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json(ApiResponse("0", "Bad signature", {}));
  }
  const agent = hasBody && req.body.agent_name ? String(req.body.agent_name).slice(0, 60) : null;
  // The rep's own partner user id, when the CRM knows it (signed, so trusted):
  // e.g. a payment link is then credited to her, as from the admin portal.
  const pid = hasBody ? parseInt(req.body.partner_user_id, 10) : NaN;
  req.user = { id: Number.isInteger(pid) && pid > 0 ? pid : null, userType: "Customer_Support_Representative", crmAgentName: agent };
  next();
}

module.exports = { verifyCrmSigned };
