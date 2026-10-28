const express = require('express');
const CountryController = require('../../controllers/FrontSite/countrycontroller');
const { validateCountry } = require('../../middlewares/packageAuth')

// Adding / editing / deleting is staff-only (was open to anyone). Reading stays open.
const { validateAdmin } = require('../../middlewares/ValidateAdmin');
const { requireAdmin } = require('../../middlewares/roleGuards');
const router = express.Router();

router.post('/', validateAdmin, requireAdmin, CountryController.createCountry);
router.get('/', CountryController.getAllCountries);
router.get('/:id', CountryController.getCountryById);
router.put('/:id', validateAdmin, requireAdmin, validateCountry, CountryController.updateCountry);
router.delete('/:id', validateAdmin, requireAdmin, CountryController.deleteCountry);

module.exports = router;