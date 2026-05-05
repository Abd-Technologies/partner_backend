'use strict';

// Phase A — Progress Screen rebuild. Adds the four symptom-card columns the
// audit flagged as missing. Historical rows stay NULL; SymptomDelta treats
// NULL as "not asked" and the card displays "Not enough data yet" until
// post-migration check-ins accumulate.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('DailyCheckins', 'bloatingSeverity', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('DailyCheckins', 'crampSeverity', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('DailyCheckins', 'sleepQuality', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('DailyCheckins', 'periodFlow', {
      type: Sequelize.ENUM('spotting', 'light', 'medium', 'heavy'),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('DailyCheckins', 'periodFlow');
    await queryInterface.removeColumn('DailyCheckins', 'sleepQuality');
    await queryInterface.removeColumn('DailyCheckins', 'crampSeverity');
    await queryInterface.removeColumn('DailyCheckins', 'bloatingSeverity');
  },
};
