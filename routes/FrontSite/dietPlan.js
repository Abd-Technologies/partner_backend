const express = require('express');
const router = express.Router();

const { validateToken } = require('../../middlewares/AuthorizationMW');
const asyncMiddleware = require('../../middlewares/async');
const ctrl = require('../../controllers/FrontSite/dietPlanController');

// Mounted at /users/diet-plan in app.js.
//
// GET   /users/diet-plan/me/active           — current user's active plan (or null)
// PATCH /users/diet-plan/me/timezone         — update the IANA timezone
// GET   /users/diet-plan/me/booking-context  — userId/userPlanId/dietitianId
//                                              for the "Book a Consultation" CTA
router.get('/me/active', validateToken, asyncMiddleware(ctrl.getMyActiveDietPlan));
router.patch('/me/timezone', validateToken, asyncMiddleware(ctrl.updateMyTimezone));
router.get(
  '/me/booking-context',
  validateToken,
  asyncMiddleware(ctrl.getMyBookingContext)
);

module.exports = router;
