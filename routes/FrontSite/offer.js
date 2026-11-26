/**
 * Campaign offer page (public, no login).
 *
 *   GET /offer/:key        e.g. /offer/reactivation?n=Ayesha
 *
 * Offers are set in config/offers.json. Read-only page.
 */
const express = require('express');
const router = express.Router();
const asyncMiddleware = require('../../middlewares/async');
const { offerPage } = require('../../controllers/FrontSite/offerPageController');

router.get('/:key', asyncMiddleware(offerPage));

module.exports = router;
