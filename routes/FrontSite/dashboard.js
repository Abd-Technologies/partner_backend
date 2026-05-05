const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const dashboardController = require("../../controllers/FrontSite/DashboardController");

router.get(
  "/dashboard",
  validateToken,
  asyncMiddleware(dashboardController.getDashboard)
);

module.exports = router;
