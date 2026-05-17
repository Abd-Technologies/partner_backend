/**
 * Magic payment link routes.
 *
 *   POST /admin/magic-links              (rep-only, validateToken)
 *   GET  /magic-links/:token             (public)
 *   POST /magic-links/:token/redeem      (public, multipart slip image)
 */

const express = require('express');
const router = express.Router();
const { validateToken } = require('../../middlewares/AuthorizationMW');
const asyncMiddleware = require('../../middlewares/async');
const ctrl = require('../../controllers/FrontSite/magicLinkController');

// Rep-side create — must be authenticated as Customer_Support_Representative or Admin.
// The auth check itself happens in validateToken (JWT decode); userType check is
// optional secondary defence at the route layer if needed.
router.post('/admin/magic-links', validateToken, asyncMiddleware(ctrl.createLink));

// Public — fetch link details for web fallback page + in-app upload screen
router.get('/magic-links/:token', asyncMiddleware(ctrl.getLink));

// Public — redeem link with slip image (multipart/form-data)
//   form fields: slip (file, required), userId (optional), payerName, payerRelationship
router.post(
  '/magic-links/:token/redeem',
  ctrl.slipUpload.single('slip'),
  asyncMiddleware(ctrl.redeemLink)
);

module.exports = router;
