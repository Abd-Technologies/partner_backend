'use strict';

// Oct 2026: Appointments.dietitianLateAlertAt — when we told the dietitian
// and admin that a confirmed session wasn't started 10 min after its start
// time (helper/dietitianLateCheck.js). Idempotent: safe on every start.
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable('Appointments');
    if (!hasColumn(desc, 'dietitianLateAlertAt')) {
      await queryInterface.addColumn('Appointments', 'dietitianLateAlertAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },
  async down() {},
};
