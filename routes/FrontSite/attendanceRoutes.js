const express = require("express");
const router = express.Router();
const { getMotivationStats, markAttendance } = require("../../controllers/FrontSite/attendanceController");
const checkActivePlan = require('../../middlewares/attendanceplancheck'); // Import the authentication middleware

router.get("/motivation/:userId", getMotivationStats);
router.post('/mark/:userId', markAttendance);
module.exports = router;
