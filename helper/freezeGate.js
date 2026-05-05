const { Op } = require("sequelize");
const { UserPlan } = require("../models");

// Shared "is this user's plan currently paused?" check for the freeze-v2
// flow. Returns the frozen UserPlan row, or null if not frozen / no
// active plan / non-User account (trainers, dietitians have no UserPlan).
//
// Intentionally only checks the freeze-v2 column (frozenAt). The legacy
// User.freeze column from the old admin endpoint is NOT checked here —
// per the design decision in docs/Freeze_Logic_Audit.md, the new gate
// only enforces freezes set via the new user-button flow. Legacy frozen
// users keep their pre-existing access.
async function findFrozenActivePlan(userId) {
  if (!userId) return null;
  return UserPlan.findOne({
    where: {
      userId,
      expireDate: { [Op.gt]: new Date() },
      frozenAt: { [Op.not]: null },
    },
    attributes: ["id", "frozenAt", "freezeDays", "expireDate"],
  });
}

module.exports = { findFrozenActivePlan };
