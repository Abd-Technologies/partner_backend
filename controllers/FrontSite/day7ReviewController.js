const ApiResponse = require("../../helper/ApiResponse");
const { createEscalation } = require("../../helper/escalation");
const {
  Day7Review,
  PendingPopupState,
  UserPlan,
  Plan,
  DietPlan,
  Appointment,
} = require("../../models");

// Same 3-step fallback as dietPlanController.js::getMyBookingContext,
// kept local rather than shared so this file doesn't take on a
// dependency on the booking-context endpoint's internals: prefer the
// active DietPlan's own dietitianId, then the UserPlan/Plan's
// dietitianId, then the most recent Appointment's dietitionId. Without
// this, every REVIEW_FLAG escalation was created with dietitianId
// hardcoded to null, which meant createEscalation's dietitian fan-out
// (helper/escalation.js) silently never fired — only admin ever heard
// about a flagged review.
async function resolveDietitianId(userId, userPlanRow) {
  const activeDietPlan = await DietPlan.findOne({
    where: { userId, status: "active" },
    attributes: ["id", "dietitianId"],
    order: [
      ["activatedAt", "DESC"],
      ["createdAt", "DESC"],
    ],
  });
  if (activeDietPlan && activeDietPlan.dietitianId) {
    return activeDietPlan.dietitianId;
  }

  const userPlanDietitianId =
    userPlanRow &&
    (userPlanRow.dietitianId != null
      ? userPlanRow.dietitianId
      : (userPlanRow.Plan && userPlanRow.Plan.dietitianId) || null);
  if (userPlanDietitianId) return userPlanDietitianId;

  const appt = await Appointment.findOne({
    where: { userId },
    order: [
      ["date", "DESC"],
      ["createdAt", "DESC"],
    ],
  });
  return appt ? appt.dietitionId : null;
}

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
    const plan = await UserPlan.findOne({
      where: { id: userPlanId, userId },
      include: [{ model: Plan, attributes: ["planType", "dietitianId"] }],
    });
    if (!plan) {
      return res.json(ApiResponse("0", "Plan not found", {}));
    }

    // planType above was previously trusted straight from the request
    // body with no server-side check at all. Now that Plan.planType
    // exists (migration 20260902000001-add-plan-type-to-plans), cross-
    // check against it when it's set — reject a mismatch instead of
    // silently recording a review under the wrong plan type. Plans not
    // yet backfilled (planType still null) fall back to trusting the
    // client, same as before, so this doesn't break anything ahead of
    // the catalog labeling pass.
    const authoritativeType = plan.Plan && plan.Plan.planType;
    if (authoritativeType && authoritativeType !== planType) {
      return res.json(
        ApiResponse(
          "0",
          `planType mismatch — this plan is actually "${authoritativeType}"`,
          {}
        )
      );
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
        const dietitianId = await resolveDietitianId(userId, plan);
        await createEscalation({
          userId,
          dietitianId,
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
