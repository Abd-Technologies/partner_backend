const express = require('express');
const router = express.Router();
const priceController = require('../../controllers/FrontSite/priceController');
const { validatePrice } = require('../../middlewares/packageAuth'); // Import the validation middleware

// CRUD Routes for Price
router.post('/', validatePrice, priceController.createPrice);          // Create a new price entry
router.put('/:id', validatePrice, priceController.updatePrice);        // Update price by ID
router.get('/', priceController.getAllPrices);                         // Get all price entries
router.get('/:id', priceController.getPriceById);                      // Get price by ID
router.delete('/:id', priceController.deletePrice);                    // Delete price by ID

module.exports = router;
