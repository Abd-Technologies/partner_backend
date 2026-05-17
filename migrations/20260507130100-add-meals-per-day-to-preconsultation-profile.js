'use strict';

// Idempotent — see 20260507130000 for rationale.

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('PreConsultationProfiles');
    if (!table.mealsPerDay) {
      await queryInterface.addColumn('PreConsultationProfiles', 'mealsPerDay', {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 5,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('PreConsultationProfiles');
    if (table.mealsPerDay) {
      await queryInterface.removeColumn('PreConsultationProfiles', 'mealsPerDay');
    }
  },
};
