const admin = require("firebase-admin");
const ApiResponse = require("../../helper/ApiResponse");
const { User } = require("../../models");

// firebase-admin is initialized in helper/notification.js at startup. Guard a
// re-init just in case this loads first, so admin.messaging() is always ready.
if (!admin.apps.length) {
  try {
    const serviceAccount = require("../../fither-e7a36-2145b07b5e5a.json");
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (e) {
    console.error("[appNotify] firebase init skipped:", e.message);
  }
}

/**
 * appNotify — POST /internal/app-notify
 *
 * Server-to-server only (called by the CRM when an admin resolves an app
 * support issue). Authenticated by the shared APP_WEBHOOK_SECRET via the
 * `x-internal-secret` header — NOT a user token. Sends a direct FCM push to the
 * user's device (bypasses preference/quiet-hours gating, since a support reply
 * should always reach the user).
 *
 * Body: { app_user_id, title?, body, data? }
 */
exports.appNotify = async (req, res) => {
  try {
    const secret = process.env.APP_WEBHOOK_SECRET;
    const provided = req.headers["x-internal-secret"];
    if (!secret || provided !== secret) {
      return res.status(403).json(ApiResponse("0", "Forbidden", {}));
    }

    const { app_user_id, title, body, data } = req.body || {};
    if (!app_user_id || !body) {
      return res.status(400).json(ApiResponse("0", "app_user_id and body are required", {}));
    }

    const user = await User.findByPk(app_user_id);
    if (!user || !user.deviceToken) {
      return res.json(ApiResponse("0", "No device token on file for this user", {}));
    }

    const stringData = {};
    Object.entries({ type: "support_resolved", ...(data || {}) }).forEach(
      ([k, v]) => { stringData[k] = String(v); }
    );

    await admin.messaging().send({
      token: user.deviceToken,
      notification: {
        title: title || "Support update",
        body: String(body).slice(0, 500),
      },
      data: stringData,
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });

    return res.json(ApiResponse("1", "Notified", {}));
  } catch (err) {
    console.error("[appNotify] failed:", err.message);
    return res.status(500).json(ApiResponse("0", "Failed to notify user", {}));
  }
};
