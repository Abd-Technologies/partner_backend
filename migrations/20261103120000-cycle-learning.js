'use strict';

// Oct 2026: the hormonal engine learns her real cycle length.
// UserCycleData.cycleHistory: JSON list of her real cycle lengths (days
// between two period starts she logged), newest last, up to 6.
// Idempotent: safe on every start.
module.exports = {
  async up(queryInterface, Sequelize, db) {
    const table = db && db.UserCycleData ? db.UserCycleData.getTableName() : 'UserCycleData';
    const cols = await queryInterface.describeTable(table);
    if (!cols.cycleHistory) {
      await queryInterface.addColumn(table, 'cycleHistory', {
        type: Sequelize.TEXT,
        allowNull: true,
      });
    }
  },
};
