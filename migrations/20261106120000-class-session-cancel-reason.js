'use strict';

// Nov 2026: why a trainer cancelled a class (portal reason picker),
// shown in the admin Class diary. Idempotent: safe on every start.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'ClassSessions';
    const cols = await queryInterface.describeTable(table);
    if (!cols.cancelReason) {
      await queryInterface.addColumn(table, 'cancelReason', { type: Sequelize.STRING(200), allowNull: true });
    }
  },
  async down(queryInterface) {
    const cols = await queryInterface.describeTable('ClassSessions');
    if (cols.cancelReason) await queryInterface.removeColumn('ClassSessions', 'cancelReason');
  },
};
