const express = require('express');
const router = express.Router();
const priceController = require('../../controllers/FrontSite/priceController');
const { validatePrice } = require('../../middlewares/packageAuth'); // Import the validation middleware
const { validateToken } = require('../../middlewares/AuthorizationMW');
const { requireAdmin } = require('../../middlewares/roleGuards');
// Sec pass 1 (Oct 2026): writes were open to anyone. Prices are Admin only;
// the GETs stay public (website + app price lists).

// CRUD Routes for Price
router.post('/', validateToken, requireAdmin, validatePrice, priceController.createPrice);          // Create a new price entry
router.put('/:id', validateToken, requireAdmin, validatePrice, priceController.updatePrice);        // Update price by ID
router.get('/', priceController.getAllPrices);                         // Get all price entries
router.get('/:id', priceController.getPriceById);                      // Get price by ID
router.delete('/:id', validateToken, requireAdmin, priceController.deletePrice);                    // Delete price by ID

module.exports = router;
