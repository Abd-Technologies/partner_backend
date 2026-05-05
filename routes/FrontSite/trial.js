const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const trialController = require("../../controllers/FrontSite/trialController");

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

module.exports = router;
