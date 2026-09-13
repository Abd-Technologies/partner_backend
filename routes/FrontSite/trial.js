const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const trialController = require("../../controllers/FrontSite/trialController");
const trialDietPlanController = require("../../controllers/FrontSite/trialDietPlanController");

router.post(
  "/validate-token",
  asyncMiddleware(trialController.validateToken)
);
router.post("/start", validateToken, asyncMiddleware(trialController.startTrial));
router.get("/me", validateToken, asyncMiddleware(trialController.getMyTrial));
router.post("/book-day", validateToken, asyncMiddleware(trialController.bookDay));
router.post(
  "/attendance",
  validateToken,
  asyncMiddleware(trialController.markAttendance)
);
router.post("/convert", validateToken, asyncMiddleware(trialController.convert));

// Trial-to-Plan funnel Steps 3+4+5 — quick intake -> auto-generate ->
// auto-activate, in one call. See trialDietPlanController.js.
router.post(
  "/quick-intake",
  validateToken,
  asyncMiddleware(trialDietPlanController.submitTrialQuickIntake)
);

module.exports = router;
