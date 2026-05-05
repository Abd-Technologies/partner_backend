// Phase B — Progress Screen rebuild.
// Mounted in app.js as: app.use('/users/progress', require('./routes/FrontSite/progress'));
//
// All endpoints are JWT-protected via accessToken header (validateToken).
// Query params for every route:
//   ?period=week|month|3month|6month|year   (default: month)
//   ?asOf=YYYY-MM-DD                         (default: today)
// /insights/hub additionally accepts ?limit=N (1..10, default 3).

const express = require('express');
const router = express.Router();

const { validateToken } = require('../../middlewares/AuthorizationMW');
const asyncMiddleware = require('../../middlewares/async');
const ProgressController = require('../../controllers/FrontSite/ProgressController');

router.get('/summary',        validateToken, asyncMiddleware(ProgressController.getSummary));
router.get('/weight',         validateToken, asyncMiddleware(ProgressController.getWeight));
router.get('/glance',         validateToken, asyncMiddleware(ProgressController.getGlance));
router.get('/hydration',      validateToken, asyncMiddleware(ProgressController.getHydration));
router.get('/symptoms',       validateToken, asyncMiddleware(ProgressController.getSymptoms));
router.get('/insights/hub',   validateToken, asyncMiddleware(ProgressController.getInsightsHub));

module.exports = router;
