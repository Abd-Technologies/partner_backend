const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const waterController = require("../../controllers/FrontSite/WaterController");

router.post(
  "/water_log",
  validateToken,
  asyncMiddleware(waterController.logWater)
);

router.get(
  "/water_log/today",
  validateToken,
  asyncMiddleware(waterController.getToday)
);

module.exports = router;
