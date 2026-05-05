const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/progressSubmissionController");

// POST /users/progress — Day 15 / Day 30 mandatory submission
router.post("/", validateToken, asyncMiddleware(ctrl.submit));

module.exports = router;
