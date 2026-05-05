const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/day7ReviewController");

// POST /users/day7-review — submit cycle review (server flags via hook)
router.post("/", validateToken, asyncMiddleware(ctrl.submitReview));

module.exports = router;
