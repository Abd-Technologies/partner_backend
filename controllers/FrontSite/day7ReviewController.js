const ApiResponse = require("../../helper/ApiResponse");
const { createEscalation } = require("../../helper/escalation");
const {
  Day7Review,
  PendingPopupState,
  UserPlan,
} = require("../../models");

const VALID_PLAN_TYPES = new Set(["diet", "workout", "combined"]);

function pickReviewFields(body) {
  // Whitelist of writable fields. The model hook computes flagged +
  // flagReasons from these — clients can't override the flag.
  const fields = [
    "cycle",
    "planType",
    "adherencePct",
    "mealsStruggled",
    "hungerLevel",
    "sideEffects",
    "difficultyLevel",
    "sessionTimingIssues",
    "painReported",
    "painLocation",
    "severeSideEffectsReported",
    "satisfaction",
  ];
  const out = {};
  for (const k of fields) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

// POST /users/day7-review
// Body shape (all optional except cycle + planType + userPlanId):
//   {
//     userPlanId, cycle, planType,
//     adherencePct, mealsStruggled, hungerLevel, sideEffects,
//     difficultyLevel, sessionTimingIssues,
//     painReported, painLocation, severeSideEffectsReported, satisfaction
//   }
// Server hook on Day7Review computes flagged + flagReasons from the
// locked thresholds (Decision 6). If flagged, an EscalationTicket
// (REVIEW_FLAG) is opened and admin is notified — the dietitian gets the
// flag indicator on the dashboard via the same row.
exports.submitReview = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const body = req.body || {};
    const userPlanId = parseInt(body.userPlanId, 10);
    const cycle = parseInt(body.cycle, 10);
    const planType = body.planType;

    if (!Number.isInteger(userPlanId) || userPlanId <= 0) {
      return res.json(ApiResponse("0", "Invalid userPlanId", {}));
    }
    if (!Number.isInteger(cycle) || cycle <= 0) {
      return res.json(ApiResponse("0", "Invalid cycle", {}));
    }
    if (!VALID_PLAN_TYPES.has(planType)) {
      return res.json(ApiResponse("0", "Invalid planType", {}));
    }

    // Confirm the plan belongs to this user (defense in depth — request
    // body forgery).
    const plan = await UserPlan.findOne({ where: { id: userPlanId, userId } });
    if (!plan) {
      return res.json(ApiResponse("0", "Plan not found", {}));
    }

    const fields = pickReviewFields(body);
    fields.userId = userId;
    fields.userPlanId = userPlanId;
    fields.cycle = cycle;
    fields.planType = planType;

    const review = await Day7Review.create(fields);

    // Flag escalation goes through the centralized helper which both
    // creates the ticket AND fans out notifications (dietitian + admin
    // per Section 12).
    if (review.flagged) {
      try {
        await createEscalation({
          userId,
          dietitianId: null,
          trigger: "REVIEW_FLAG",
          severity: "high",
          payload: {
            reviewId: review.id,
            userPlanId,
            cycle,
            planType,
            flagReasons: review.flagReasons,
          },
        });
      } catch (e) {
        // Don't fail the user-facing submit just because escalation
        // bookkeeping hiccupped — surface in logs and continue.
        console.error("[day7Review] escalation create failed:", e);
      }
    }

    // Retire the popup state for this cycle so the eligibility helper
    // doesn't keep trying to surface it.
    try {
      const variable = "POPUP_DAY7_REVIEW";
      const existing = await PendingPopupState.findOne({
        where: { userId, popupVariable: variable, completedAt: null },
        order: [["createdAt", "DESC"]],
      });
      if (existing) {
        await existing.update({ completedAt: new Date() });
      } else {
        await PendingPopupState.create({
          userId,
          popupVariable: variable,
          completedAt: new Date(),
          metadata: { reviewId: review.id, cycle },
        });
      }
    } catch (e) {
      console.error("[day7Review] popup state update failed:", e);
    }

    return res.json(
      ApiResponse("1", "Review submitted", { review: review.toJSON() })
    );
  } catch (err) {
    console.error("[day7Review] submitReview:", err);
    return res.json(ApiResponse("0", "Failed to submit review", {}));
  }
};
