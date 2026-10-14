// activePackage.js — one definition of "this package is live right now",
// for anything that pushes notifications about classes.
//
// Live = turned on (status true), not expired, not cancelled, not paused
// (frozenAt is the canonical pause flag, see helper/freezeGate.js).
// Before this, workout class pushes went to every UserPlan ever bought,
// so expired, cancelled and paused users kept getting "class starting"
// and "join the session now" notifications.
const { Op } = require("sequelize");

function activeUserPlanWhere() {
  return {
    status: true,
    frozenAt: null,
    cancelledAt: null,
    [Op.or]: [{ expireDate: null }, { expireDate: { [Op.gte]: new Date() } }],
  };
}

module.exports = { activeUserPlanWhere };
