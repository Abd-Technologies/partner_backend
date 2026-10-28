// Dietitian "Emergency: cancel my day" (Oct 2026). Mounted at /emergency-day.
const express = require("express");
const router = express.Router();
const ctrl = require("../../controllers/FrontSite/emergencyDayController");
const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");

router.get("/preview", validateToken, asyncMiddleware(ctrl.preview));
router.get("/awaiting", validateToken, asyncMiddleware(ctrl.awaiting));
router.post("/", validateToken, asyncMiddleware(ctrl.request));
router.post("/:id/undo", validateToken, asyncMiddleware(ctrl.undo));
router.post("/:id/decide", validateToken, asyncMiddleware(ctrl.decide));

module.exports = router;
