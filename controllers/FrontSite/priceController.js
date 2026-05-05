
const Countries = require('../../models/Country'); // Import the Countries model
const PriceDurations = require('../../models/PriceDuration'); // Import the PriceDurations model
const Plan = require('../../models/Plan'); // Import the Plan model
const Price = require('../../models/Price')
module.exports = {
    // Create a new price entry
    async createPrice(req, res) {
        try {
            const { countryId, durationId, planId, priceAmount } = req.body;
            const price = await Price.create({ countryId, durationId, planId, priceAmount });
            res.status(201).json(price);
        } catch (error) {
            res.status(500).json({ message: 'Error creating price', error });
        }
    },

    // Get all price entries
    async getAllPrices(req, res) {
        try {
            const prices = await Price.findAll({
                include: [
                    { model: Countries, attributes: ['name'] },
                    { model: PriceDurations, attributes: ['duration'] },
                    { model: Plan, attributes: ['name', 'description', 'plan_type'] }
                ]
            });
            res.status(200).json(prices);
        } catch (error) {
            res.status(500).json({ message: 'Error retrieving prices', error });
        }
    },

    // Get price by ID
    async getPriceById(req, res) {
        try {
            const price = await Price.findByPk(req.params.id, {
                include: [
                    { model: Countries, attributes: ['name'] },
                    { model: PriceDurations, attributes: ['duration'] },
                    { model: Plan, attributes: ['name', 'description', 'plan_type'] }
                ]
            });
            if (!price) {
                return res.status(404).json({ message: 'Price not found' });
            }
            res.status(200).json(price);
        } catch (error) {
            res.status(500).json({ message: 'Error retrieving price', error });
        }
    },

    // Update price by ID
    async updatePrice(req, res) {
        try {
            const { countryId, durationId, planId, priceAmount } = req.body;
            const price = await Price.findByPk(req.params.id);
            if (!price) {
                return res.status(404).json({ message: 'Price not found' });
            }
            await price.update({ countryId, durationId, planId, priceAmount });
            res.status(200).json(price);
        } catch (error) {
            res.status(500).json({ message: 'Error updating price', error });
        }
    },

    // Delete price by ID
    async deletePrice(req, res) {
        try {
            const price = await Price.findByPk(req.params.id);
            if (!price) {
                return res.status(404).json({ message: 'Price not found' });
            }
            await price.destroy();
            res.status(200).json({ message: 'Price deleted successfully' });
        } catch (error) {
            res.status(500).json({ message: 'Error deleting price', error });
        }
    }
};
