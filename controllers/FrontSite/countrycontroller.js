const {
    Countries,
  } = require("../../models");

  const ApiResponse = require("../../helper/ApiResponse");


// Create a new Country
exports.createCountry = async (req, res) => {
    try {
        const { code, name } = req.body;
        const exist = await Countries.findOne({where:{ "name": name }}); // Add `await` here
        
        if (exist) {
            console.log("Country already exists:", exist);

            const response = ApiResponse("0", "Already Exist", {});
            return res.json(response);
        }
        
        // Create a new Country entry
        const country = new Countries();
        country.name = name;
        country.code = code;
        await country.save();

        const response = ApiResponse("1", "Country created successfully", {});
        return res.json(response);
        
    } catch (error) {
        const response = ApiResponse("0", error.toString(), {});
        return res.json(response);
    }
};


// Get all Countries
exports.getAllCountries = async (req, res, next) => {
    try {
        const countries = await Countries.findAll();

        const response = ApiResponse("1", "Countries", {"countries":countries});
        return res.json(response);
    } catch (error) {
        const response = ApiResponse("0", "Error fetching countries", {});
        return res.json(response);
    }
};

// Get a Country by ID
exports.getCountryById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const country = await Countries.findByPk(id);

        if (!country) {
            return res.status(404).json({ message: 'Country not found' });
        }

        res.status(200).json({ country });
    } catch (error) {
        next(error);
    }
};

// Update a Country
exports.updateCountry = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { code, name } = req.body;

        // Find the Country by ID
        const country = await Countries.findByPk(id);
        if (!country) {
            return res.status(404).json({ message: 'Country not found' });
        }

        // Update the Country details
        await country.update({ code, name });

        res.status(200).json({ message: 'Country updated successfully', country });
    } catch (error) {
        next(error);
    }
};

// Delete a Country
exports.deleteCountry = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Find the Country by ID
        const country = await Countries .findByPk(id);
        if (!country) {
            return res.status(404).json({ message: 'Country not found' });
        }

        // Delete the Country
        await country.destroy();

        res.status(200).json({ message: 'Country deleted successfully' });
    } catch (error) {
        next(error);
    }
};
