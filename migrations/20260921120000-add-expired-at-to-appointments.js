'use strict';

// Adds `expiredAt` — marks a "pending" appointment (client booked it,
// dietitian never confirmed it) that got auto-canceled because its
// scheduled time passed with nobody ever responding.
//
// Deliberately a SEPARATE column from `noShowReportedAt`, even though
// both end up as status:"canceled": `noShowReportedAt` means "this was
// CONFIRMED and the dietitian just never joined"; `expiredAt` means
// "the dietitian never even confirmed it in the first place". Different
// situations, different client-facing message, and Shaista wants them
// tracked separately in the escalations history.
//
// Idempotent — safe to run more than once.

function findColumnKey(tableDescription, lowerName) {
  return Object.keys(tableDescription).find(
    (k) => k.toLowerCase() === lowerName
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Appointments');
    if (!findColumnKey(table, 'expiredat')) {
      await queryInterface.addColumn('Appointments', 'expiredAt', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Appointments');
    const existingKey = findColumnKey(table, 'expiredat');
    if (existingKey) {
      await queryInterface.removeColumn('Appointments', existingKey);
    }
  },
};
