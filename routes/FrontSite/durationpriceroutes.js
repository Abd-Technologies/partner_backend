const express = require('express');
const PriceDurationController = require('../../controllers/FrontSite/durationprice');
const { validatePriceDuration } = require('../../middlewares/packageAuth');

const router = express.Router();

router.post('/', PriceDurationController.createPriceDuration);
router.get('/', PriceDurationController.getAllPriceDurations);
router.get('/:id', PriceDurationController.getPriceDurationById);
router.put('/:id', validatePriceDuration, PriceDurationController.updatePriceDuration);
router.delete('/:id', PriceDurationController.deletePriceDuration);

module.exports = router;
