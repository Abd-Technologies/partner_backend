const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/preConsultationController");

// Mount under `/users/pre-consultation` — the user can only ever read or
// patch their own profile. Admin/dietitian operations live in
// routes/Admin/preConsultation.js.
router.get("/", validateToken, asyncMiddleware(ctrl.getOwnProfile));
router.patch("/", validateToken, asyncMiddleware(ctrl.updateOwnProfile));

module.exports = router;
