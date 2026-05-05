const ApiResponse = require("../../helper/ApiResponse");
const { createEscalation } = require("../../helper/escalation");

// User-initiated triggers that don't fall out of structured forms
// (no-show is its own endpoint, review-flag is auto from the review POST).
// Section 12 trigger 5 — MEDICAL — is the primary user-side trigger here;
// PLAN_DELAYED is a related self-report path.
const USER_TRIGGERABLE = new Set(["MEDICAL", "PLAN_DELAYED"]);

// POST /users/escalations
// Body: { trigger, payload?: { ... }, severity? }
exports.openTicket = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const trigger = req.body && req.body.trigger;
    if (typeof trigger !== "string" || !USER_TRIGGERABLE.has(trigger)) {
      return res.json(ApiResponse("0", "Invalid trigger", {}));
    }

    const severity =
      req.body &&
      ["low", "medium", "high"].includes(req.body.severity)
        ? req.body.severity
        : trigger === "MEDICAL"
        ? "high"
        : "medium";

    // Routing: dietitian assignment happens via the helper's notification
    // fan-out — admins always get notified; the dietitian channel only
    // fires when we know a dietitianId. User-side triggers don't carry
    // that link directly, so admin-only here is acceptable.
    const ticket = await createEscalation({
      userId,
      dietitianId: null,
      trigger,
      severity,
      payload: (req.body && req.body.payload) || null,
    });

    return res.json(
      ApiResponse("1", "Escalation opened", { ticket: ticket.toJSON() })
    );
  } catch (err) {
    console.error("[escalation] openTicket:", err);
    return res.json(ApiResponse("0", "Failed to open escalation", {}));
  }
};
