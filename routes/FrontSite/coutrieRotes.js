const express = require('express');
const CountryController = require('../../controllers/FrontSite/countrycontroller');
const { validateCountry } = require('../../middlewares/packageAuth')

const router = express.Router();

router.post('/', CountryController.createCountry);
router.get('/', CountryController.getAllCountries);
router.get('/:id', CountryController.getCountryById);
router.put('/:id', validateCountry, CountryController.updateCountry);
router.delete('/:id', CountryController.deleteCountry);

module.exports = router;