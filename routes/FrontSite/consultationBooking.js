const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/consultationBookingController");

// GET /users/dietitian-availability?dietitianId=&from=&to=
router.get(
  "/dietitian-availability",
  validateToken,
  asyncMiddleware(ctrl.getDietitianAvailability)
);

module.exports = router;
