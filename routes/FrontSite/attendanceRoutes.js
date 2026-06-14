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
module.exports = router;
