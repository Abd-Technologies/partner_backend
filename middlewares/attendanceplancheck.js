// middleware/checkActivePlan.js
const { UserPlan } = require('../models');
const { Op } = require('sequelize');

async function checkActivePlan(req, res, next) {
  try {
    const userId = req.user.id;  // from auth middleware

    // Find the user's current active plan where expiry_date is in future
    const activePlan = await UserPlan.findOne({
      where: {
        user_id: userId,
        expiry_date: {
          [Op.gte]: new Date()  // plan expiry date is >= today
        }
      }
    });

    if (!activePlan) {
      return res.status(403).json({ message: "No active plan found. Access denied." });
    }

    next();
  } catch (err) {
    res.status(500).json({ message: "Server error." });
  }
}

module.exports = checkActivePlan;
