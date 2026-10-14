const express = require("express");
const router = express.Router();
const { getMotivationStats, markAttendance } = require("../../controllers/FrontSite/attendanceController");
const classPresenceController = require("../../controllers/FrontSite/classPresenceController");
const checkActivePlan = require('../../middlewares/attendanceplancheck'); // Import the authentication middleware
const { validateToken } = require("../../middlewares/AuthorizationMW");

router.get("/motivation/:userId", getMotivationStats);
router.post('/mark/:userId', markAttendance);
router.post("/presence/join", validateToken, classPresenceController.join);
router.post("/presence/leave", validateToken, classPresenceController.leave);

// Class feedback (fitHer Flows › Class feedback)
const classFeedback = require("../../controllers/FrontSite/classFeedbackController");
router.get("/feedback/pending", validateToken, classFeedback.pending);
router.post("/feedback", validateToken, classFeedback.submit);
router.post("/feedback/skip", validateToken, classFeedback.skip);
router.get("/feedback/trainer", validateToken, classFeedback.trainerSummary);
module.exports = router;
