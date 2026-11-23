// Signed calls from the app backend to the CRM's app API (Nov 2026).
// Same scheme the CRM checks (fithercrm webhookVerifier.verifyAppRead):
//   x-webhook-timestamp: <unix s>
//   x-webhook-signature: sha256=HMAC(APP_WEBHOOK_SECRET, "<ts>.<METHOD>.<path+query>.<raw body>")
// CRM base: CRM_BASE_URL, or the origin of CRM_WEBHOOK_URL.
const crypto = require("crypto");
const axios = require("axios");

function crmBase() {
  if (process.env.CRM_BASE_URL) return process.env.CRM_BASE_URL.replace(/\/$/, "");
  try { return new URL(process.env.CRM_WEBHOOK_URL).origin; } catch (_) { return null; }
}

async function crmCall(method, path, bodyObj, { timeout = 45000 } = {}) {
  const base = crmBase();
  const secret = process.env.APP_WEBHOOK_SECRET;
  if (!base || !secret) throw Object.assign(new Error("CRM not configured"), { status: 503 });
  const raw = bodyObj ? JSON.stringify(bodyObj) : "";
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${method}.${path}.${raw}`).digest("hex");
  const resp = await axios({
    method,
    url: base + path,
    headers: { "Content-Type": "application/json", "x-webhook-timestamp": ts, "x-webhook-signature": `sha256=${sig}` },
    data: bodyObj ? raw : undefined,
    transformRequest: [(d) => d], // send exactly the signed bytes
    timeout,
  });
  return resp.data;
}

module.exports = { crmCall, crmBase };
