const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const trialController = require("../../controllers/FrontSite/trialController");
const trialDietPlanController = require("../../controllers/FrontSite/trialDietPlanController");

// Public landing page for the rep's invite link (app not installed, or
// opened in a browser). See trialLandingController.js.
const { trialLandingPage } = require("../../controllers/FrontSite/trialLandingController");
router.get("/", asyncMiddleware(trialLandingPage));

router.post(
  "/validate-token",
  asyncMiddleware(trialController.validateToken)
);
router.post("/start", validateToken, asyncMiddleware(trialController.startTrial));
router.get("/me", validateToken, asyncMiddleware(trialController.getMyTrial));
// Class schedule for the trial onboarding class picker (no booking).
router.get("/classes", validateToken, asyncMiddleware(trialController.listClasses));
// End-of-trial summary + offer (her country's prices).
router.get("/summary", validateToken, asyncMiddleware(trialController.getSummary));
router.get("/moment", validateToken, asyncMiddleware(trialController.getMoment));
router.post("/moment/seen", validateToken, asyncMiddleware(trialController.markMomentSeen));
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
