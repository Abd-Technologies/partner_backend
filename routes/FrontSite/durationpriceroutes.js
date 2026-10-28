const express = require('express');
const PriceDurationController = require('../../controllers/FrontSite/durationprice');
const { validatePriceDuration } = require('../../middlewares/packageAuth');

// Adding / editing / deleting is staff-only (was open to anyone). Reading stays open.
const { validateAdmin } = require('../../middlewares/ValidateAdmin');
const { requireAdmin } = require('../../middlewares/roleGuards');
const router = express.Router();

router.post('/', validateAdmin, requireAdmin, PriceDurationController.createPriceDuration);
router.get('/', PriceDurationController.getAllPriceDurations);
router.get('/:id', PriceDurationController.getPriceDurationById);
router.put('/:id', validateAdmin, requireAdmin, validatePriceDuration, PriceDurationController.updatePriceDuration);
router.delete('/:id', validateAdmin, requireAdmin, PriceDurationController.deletePriceDuration);

module.exports = router;
