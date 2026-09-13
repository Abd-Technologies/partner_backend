const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/progressSubmissionController");

// POST /users/progress — Day 15 / Day 30 mandatory submission
router.post("/", validateToken, asyncMiddleware(ctrl.submit));

// GET /users/progress/previous?userPlanId=&cycle= — prefill data for the
// popup's "Last: X kg" ghost text (Section 9).
router.get("/previous", validateToken, asyncMiddleware(ctrl.getPrevious));

module.exports = router;
