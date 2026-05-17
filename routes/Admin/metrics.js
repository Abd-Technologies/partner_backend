const express = require("express");
const router = express.Router();

const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/Admin/metricsController");

// GET /admin/metrics/overview — Section 15 dashboard summary.
router.get("/overview", validateAdmin, asyncMiddleware(ctrl.overview));

module.exports = router;
