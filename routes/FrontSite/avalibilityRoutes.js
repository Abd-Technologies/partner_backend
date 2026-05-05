// routes/availabilityRoutes.js
const express = require('express');
const availabilityController = require('../../controllers/FrontSite/availibiltyController');
const auth = require('../../middlewares/authMiddleware'); // Import the authentication middleware

const router = express.Router();

// Route to get all availabilities
// router.get('/',auth, availabilityController.getAllAvailabilities);

// Route to get a specific availability by ID
router.get('/:id', availabilityController.getAvailabilityById);

// Route to create a new availability
router.post('/', auth,availabilityController.createAvailability);

// Route to update an existing availability
router.put('/:id', availabilityController.updateAvailability);

// Route to delete an availability
router.delete('/:id', availabilityController.deleteAvailability);

module.exports = router;
