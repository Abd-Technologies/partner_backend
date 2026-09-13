'use strict';

/**
 * Add ocrReceiver column to PlanImages table to track detected recipient
 * (e.g. FitHer, Shaista Khalid, or third-party).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('PlanImages');

    if (!table.ocrReceiver) {
      await queryInterface.addColumn('PlanImages', 'ocrReceiver', {
        type: Sequelize.STRING(120),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('PlanImages');
    if (table.ocrReceiver) {
      await queryInterface.removeColumn('PlanImages', 'ocrReceiver');
    }
  },
};
