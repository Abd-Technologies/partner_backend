// controllers/availabilityController.js
const Availability = require('../../models/Avalibility');
const TeamMember = require('../../models/User');

// Get all availabilities
exports.getAllAvailabilities = async (req, res) => {
    try {
        const availabilities = await Availability.findAll({
            include: [TeamMember], // Include related TeamMember data
        });
        res.status(200).json(availabilities);
    } catch (error) {
        console.error('Error fetching availabilities:', error);
        res.status(500).json({ error: 'Error fetching availabilities' });
    }
};

// Get availability by ID
exports.getAvailabilityById = async (req, res) => {
    const { id } = req.params;
    try {
        const availability = await Availability.findByPk(id, {
            include: [TeamMember],
        });
        if (!availability) {
            return res.status(404).json({ error: 'Availability not found' });
        }
        res.status(200).json(availability);
    } catch (error) {
        console.error('Error fetching availability:', error);
        res.status(500).json({ error: 'Error fetching availability' });
    }
};

// Create a new availability
exports.createAvailability = async (req, res) => {
    const { day, isAvailable } = req.body;
    try {
        const newAvailability = await Availability.create({
            day,
            isAvailable,
            teamMemberId: req.user.id
        });
        res.status(201).json(newAvailability);
    } catch (error) {
        console.error('Error creating availability:', error);
        res.status(500).json({ error: 'Error creating availability' });
    }
};

// Update an existing availability
exports.updateAvailability = async (req, res) => {
    const { id } = req.params;
    const { day, isAvailable, teamMemberId } = req.body;
    try {
        const availability = await Availability.findByPk(id);
        if (!availability) {
            return res.status(404).json({ error: 'Availability not found' });
        }
        availability.day = day;
        availability.isAvailable = isAvailable;
        availability.teamMemberId = teamMemberId;
        await availability.save();
        res.status(200).json(availability);
    } catch (error) {
        console.error('Error updating availability:', error);
        res.status(500).json({ error: 'Error updating availability' });
    }
};

// Delete an availability
exports.deleteAvailability = async (req, res) => {
    const { id } = req.params;
    try {
        const availability = await Availability.findByPk(id);
        if (!availability) {
            return res.status(404).json({ error: 'Availability not found' });
        }
        await availability.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting availability:', error);
        res.status(500).json({ error: 'Error deleting availability' });
    }
};
