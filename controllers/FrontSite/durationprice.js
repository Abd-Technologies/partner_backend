const {
    PriceDurations,
  } = require("../../models");
  const Country = require('../../models/Country');

  const ApiResponse = require("../../helper/ApiResponse");

// Create a new PriceDuration
exports.createPriceDuration = async (req, res, next) => {
    try {
        const { duration, countryId } = req.body;

        // Create a new PriceDuration entry
        const priceDuration = new PriceDurations();
        priceDuration.duration=duration;
        priceDuration.countryId=countryId;
        await priceDuration.save();
        const response = ApiResponse("1", "Duration created successfully", {});
        return res.json(response);    

    } catch (error) {
        const response = ApiResponse("0", error.toString(), {});
        return res.json(response);    }
};

// Get all PriceDurations
exports.getAllPriceDurations = async (req, res, next) => {
    try {
        const priceDurations = await PriceDurations.findAll({
            
        });
        const response = ApiResponse("1", "Durations", {"durations":priceDurations});
        return res.json(response);
    } catch (error) {
        const response = ApiResponse("0", error.toString() , {});
        return res.json(response);
    }
};

// Get a PriceDuration by ID
exports.getPriceDurationById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const priceDuration = await PriceDuration.findByPk(id, {
            include: [{ model: Country, as: 'country' }],
        });

        if (!priceDuration) {
            return res.status(404).json({ message: 'PriceDuration not found' });
        }

        res.status(200).json({ priceDuration });
    } catch (error) {
        next(error);
    }
};

// Update a PriceDuration
exports.updatePriceDuration = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { duration, price, countryId } = req.body;

        // Find the PriceDuration by ID
        const priceDuration = await PriceDuration.findByPk(id);
        if (!priceDuration) {
            return res.status(404).json({ message: 'PriceDuration not found' });
        }

        // Update the PriceDuration details
        await priceDuration.update({ duration, price, countryId });

        res.status(200).json({ message: 'PriceDuration updated successfully', priceDuration });
    } catch (error) {
        next(error);
    }
};

// Delete a PriceDuration
exports.deletePriceDuration = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Find the PriceDuration by ID
        const priceDuration = await PriceDuration.findByPk(id);
        if (!priceDuration) {
            return res.status(404).json({ message: 'PriceDuration not found' });
        }

        // Delete the PriceDuration
        await priceDuration.destroy();

        res.status(200).json({ message: 'PriceDuration deleted successfully' });
    } catch (error) {
        next(error);
    }
};
