'use strict';

// Nov 2026: a note from the dietitian to the client, shown at the top of
// her plan ("Drink 2 L of water, avoid fried food"). Idempotent.
module.exports = {
  async up(queryInterface, Sequelize, db) {
    const table = db && db.DietPlan ? db.DietPlan.getTableName() : 'DietPlans';
    const cols = await queryInterface.describeTable(table);
    if (!cols.clientNote) await queryInterface.addColumn(table, 'clientNote', { type: Sequelize.TEXT, allowNull: true });
  },
};
