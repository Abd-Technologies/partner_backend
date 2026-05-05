const express = require("express");
const router = express.Router();

const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/Admin/day7ReviewAdminController");

// GET /admin/day7-reviews?flagged=true&userId=&limit=&offset=
router.get("/", validateAdmin, asyncMiddleware(ctrl.listReviews));

module.exports = router;
