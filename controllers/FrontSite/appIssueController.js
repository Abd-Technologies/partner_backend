const crypto = require("crypto");
const axios = require("axios");
const ApiResponse = require("../../helper/ApiResponse");
const { User, UserPlan, Plan } = require("../../models");

// Best-effort lookup of the user's current package/plan, so the admin sees
// what the person is subscribed to alongside their reported issue.
async function getUserPlan(userId) {
  try {
    const up = await UserPlan.findOne({
      where: { userId },
      order: [["createdAt", "DESC"]],
    });
    if (!up) return null;
    let title = null;
    try {
      const pl = await Plan.findByPk(up.PlanId);
      title = (pl && pl.title) || null;
    } catch (_) { /* ignore */ }
    return {
      title,
      status: up.planStatus || (up.status ? "active" : "inactive"),
      expires: up.expireDate ? new Date(up.expireDate).toISOString().slice(0, 10) : null,
    };
  } catch (_) {
    return null;
  }
}

/**
 * reportIssue — POST /users/app-issue
 *
 * A user reports a technical / app-service issue from the app. We relay it to
 * the CRM as a `support_issue` webhook, where it lands in the ADMIN support
 * queue (not the sales reps). An optional screenshot is uploaded to
 * /public/issueUploads and its public URL is passed along.
 *
 * Body (multipart/form-data):
 *   message   — text description (required unless an image is attached)
 *   category  — optional ("APP_ISSUE" | "PAYMENT" | "PLAN" | "CLASS" | "OTHER" | "MEDICAL")
 *   image     — optional screenshot file (field name "image")
 */
exports.reportIssue = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const message = (req.body && req.body.message ? String(req.body.message) : "").trim();
    const category = req.body && req.body.category ? String(req.body.category) : "APP_ISSUE";
    const hasImage = !!req.file;

    if (!message && !hasImage) {
      return res.json(ApiResponse("0", "Please describe the issue or attach a screenshot.", {}));
    }

    // Public URL for the screenshot (served via the static /public mount).
    let imageUrl = null;
    if (hasImage) {
      const base = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/+$/, "");
      imageUrl = `${base}/public/issueUploads/${req.file.filename}`;
    }

    // Pull contact details + current plan so the CRM can link the lead and the
    // admin can see which package the user is on.
    let user = null;
    try { user = await User.findByPk(userId); } catch (_) { /* non-fatal */ }
    const plan = await getUserPlan(userId);

    const payload = {
      app_user_id: String(userId),
      message,
      category,
      priority: category === "MEDICAL" ? "high" : "normal",
      image_url: imageUrl,
      phone: (user && user.phone) || null,
      email: (user && user.email) || null,
      name: (user && user.name) || null,
      plan, // { title, status, expires } | null
      external_event_id: `issue_${userId}_${Date.now()}`,
    };

    const crmUrl = process.env.CRM_WEBHOOK_URL; // e.g. https://crm.backend.thefither.com/api/webhooks/app/event
    const secret = process.env.APP_WEBHOOK_SECRET;
    if (!crmUrl || !secret) {
      console.error("[appIssue] CRM_WEBHOOK_URL or APP_WEBHOOK_SECRET not configured");
      return res.json(ApiResponse("0", "Support is temporarily unavailable. Please try again later.", {}));
    }

    // Sign the RAW body — the CRM verifies HMAC-SHA256 over the exact bytes.
    const raw = JSON.stringify({ event_type: "support_issue", payload });
    const signature =
      "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");

    await axios.post(crmUrl, raw, {
      headers: {
        "Content-Type": "application/json",
        "x-webhook-signature": signature,
      },
      timeout: 15000,
    });

    return res.json(ApiResponse("1", "Your issue has been sent to our team.", { image_url: imageUrl }));
  } catch (err) {
    console.error("[appIssue] reportIssue:", err.response?.data || err.message);
    return res.json(ApiResponse("0", "Failed to send your issue. Please try again.", {}));
  }
};
