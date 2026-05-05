const ApiResponse = require("../../helper/ApiResponse");
const { PendingPopupState } = require("../../models");

// Whitelist of popup variables the client may post about. Server rejects
// unknown variables so a typo or stale client can't poison the state row.
const KNOWN_POPUPS = new Set([
  "POPUP_BOOK_INITIAL_CONSULTATION",
  "POPUP_PRE_CONSULTATION_FORM",
  "POPUP_BOOK_INITIAL_REMINDER",
  "POPUP_EARLY_CHECKIN",
  "POPUP_DAY7_REVIEW",
  "POPUP_DAY15_PROGRESS",
  "POPUP_BOOK_FOLLOWUP_CONSULTATION",
  "POPUP_DAY30_PROGRESS",
  "POPUP_RENEW_PLAN",
  "POPUP_DAILY_LOG_REMINDER",
  "POPUP_INACTIVITY_REMINDER",
  "POPUP_PLAN_DELAYED",
  "POPUP_CONSULTANT_NO_SHOW",
  "POPUP_MEDICAL_CONCERN",
  "POPUP_PHOTO_PRIVACY_NOTICE",
]);

// Helper: locate the active (not-yet-completed) state row for this user +
// popup. We may have historical completed rows for older cycles; those are
// frozen, so we always operate on the latest non-completed row.
async function findActiveState(userId, popupVariable) {
  return PendingPopupState.findOne({
    where: { userId, popupVariable, completedAt: null },
    order: [["createdAt", "DESC"]],
  });
}

// POST /users/popup/:variable/dismiss
// Body: optional { metadata: {...} }
// Increments dismissCount, sets lastShownAt = now. Does NOT retire the
// popup — the eligibility helper decides when to suppress based on
// dismissCount.
exports.dismissPopup = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const variable = req.params.variable;
    if (!KNOWN_POPUPS.has(variable)) {
      return res.json(ApiResponse("0", "Unknown popup variable", {}));
    }

    let state = await findActiveState(userId, variable);
    if (!state) {
      // Defensive: if the eligibility cron hasn't materialised the row yet,
      // create one now so dismissCount survives. eligibleAt remains NULL —
      // the next eligibility pass will set it.
      state = await PendingPopupState.create({
        userId,
        popupVariable: variable,
        dismissCount: 0,
        metadata: req.body && req.body.metadata,
      });
    }

    await state.update({
      dismissCount: (state.dismissCount || 0) + 1,
      lastShownAt: new Date(),
    });

    return res.json(
      ApiResponse("1", "Popup dismissed", { state: state.toJSON() })
    );
  } catch (err) {
    console.error("[popupState] dismissPopup:", err);
    return res.json(ApiResponse("0", "Failed to dismiss popup", {}));
  }
};

// POST /users/popup/:variable/complete
// Stamps completedAt; the row becomes frozen history. Subsequent
// eligibility passes that need to fire the same popup again (next cycle)
// will create a fresh row.
exports.completePopup = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const variable = req.params.variable;
    if (!KNOWN_POPUPS.has(variable)) {
      return res.json(ApiResponse("0", "Unknown popup variable", {}));
    }

    let state = await findActiveState(userId, variable);
    if (!state) {
      // No active state — create one so the completion is recorded.
      state = await PendingPopupState.create({
        userId,
        popupVariable: variable,
        metadata: req.body && req.body.metadata,
      });
    }

    await state.update({ completedAt: new Date() });

    return res.json(
      ApiResponse("1", "Popup completed", { state: state.toJSON() })
    );
  } catch (err) {
    console.error("[popupState] completePopup:", err);
    return res.json(ApiResponse("0", "Failed to complete popup", {}));
  }
};
