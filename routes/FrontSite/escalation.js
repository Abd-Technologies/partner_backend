const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/escalationController");

// POST /users/escalations — user opens ticket (MEDICAL or PLAN_DELAYED)
router.post("/", validateToken, asyncMiddleware(ctrl.openTicket));

module.exports = router;
