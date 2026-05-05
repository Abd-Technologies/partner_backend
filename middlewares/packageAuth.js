// File: authMiddleware.js

// Validation for Workout Package

// Validation middleware for creating a WorkoutPackage
exports.validateWorkoutPackage = (req, res, next) => {
    const { name, description } = req.body;

    // Check for required fields
    if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({ error: 'Name is required and must be a non-empty string.' });
    }


    if (description && typeof description !== 'string') {
        return res.status(400).json({ error: 'Description must be a string if provided.' });
    }


    // If all validations pass, proceed to the next middleware
    next();
};

// Validation for Workout Schedule
exports.validateWorkoutSchedule = (req, res, next) => {
    const { day, workoutPackageId } = req.body;
    if (!day || !workoutPackageId) {
        return res.status(400).json({ error: "Date, time, and packageId are required" });
    }
    next();
};
const { body, validationResult } = require('express-validator');

exports.validatePriceDuration = [
    body('duration')
        .isString()
        .withMessage('Duration should be a string')
        .notEmpty()
        .withMessage('Duration is required'),

    body('countryId')
        .isInt()
        .withMessage('Country ID should be an integer')
        .notEmpty()
        .withMessage('Country ID is required'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
];

exports.validateCountry = [
    body('code')
        .isString()
        .withMessage('Code should be a string')
        .isLength({ min: 2, max: 3 })
        .withMessage('Code should be 2 or 3 characters long')
        .notEmpty()
        .withMessage('Code is required'),
    body('name')
        .isString()
        .withMessage('Name should be a string')
        .notEmpty()
        .withMessage('Name is required'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    },
];


// Validation for Workout Time Slot
exports.validateWorkoutTimeSlot = (req, res, next) => {
    const { timeSlot, workoutScheduleId } = req.body;
    // res.json(req.body)
    // Check if timeSlot is provided and is a string
    if (!timeSlot || typeof timeSlot !== 'string') {
        return res.status(400).json({ error: "Time slot is required and must be a string." });
    }

    // Check if workoutScheduleId is provided and is a number
    if (!workoutScheduleId || typeof workoutScheduleId !== 'number') {
        return res.status(400).json({ error: "Workout Schedule ID is required and must be a number." });
    }

    next(); // Proceed to the next middleware or route handler if validation is successful
};


// Validation for Workout Plan
exports.validateWorkoutPlan = (req, res, next) => {
    const { title, description, duration } = req.body;
    if (!title || !description || !duration) {
        return res.status(400).json({ error: "Title, description, and duration are required" });
    }
    next();
};

// Validation for Feedback
exports.validateFeedback = (req, res, next) => {
    const { userId, rating, comment } = req.body;
    if (!userId || !rating || !comment) {
        return res.status(400).json({ error: "User ID, rating, and comment are required" });
    }
    next();
};



// Validation for Price
exports.validatePrice = (req, res, next) => {
    const { countryId, durationId, planId, priceAmount } = req.body;

    if (!countryId || !durationId || !planId || priceAmount == null) {
        return res.status(400).json({ error: 'countryId, durationId, planId, and priceAmount are required.' });
    }

    next();
};
