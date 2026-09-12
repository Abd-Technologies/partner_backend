// middleware/checkActivePlan.js
const { UserPlan } = require('../models');
const { Op } = require('sequelize');

async function checkActivePlan(req, res, next) {
  try {
    const userId = req.user.id;  // from auth middleware

    // Find the user's current active plan where expireDate is in the future.
    // Fix: field names must match the Sequelize model — userId and expireDate
    // (camelCase), not user_id / expiry_date (snake_case).
    const activePlan = await UserPlan.findOne({
      where: {
        userId,
        expireDate: {
          [Op.gte]: new Date()
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
