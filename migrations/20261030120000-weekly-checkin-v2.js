'use strict';

// One weekly check-in (Oct 2026): extra WeeklyCheckins columns.
// Idempotent — safe on every start.
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const desc = await queryInterface.describeTable('WeeklyCheckins');
    const cols = {
      chestCm: { type: Sequelize.FLOAT, allowNull: true },
      armsCm: { type: Sequelize.FLOAT, allowNull: true },
      thighsCm: { type: Sequelize.FLOAT, allowNull: true },
      userPlanId: { type: Sequelize.INTEGER, allowNull: true },
      checkinDay: { type: Sequelize.INTEGER, allowNull: true },
      planAnswers: { type: Sequelize.JSON, allowNull: true },
      milestoneAnswers: { type: Sequelize.JSON, allowNull: true },
    };
    for (const [name, def] of Object.entries(cols)) {
      if (!hasColumn(desc, name)) await queryInterface.addColumn('WeeklyCheckins', name, def);
    }
  },
  async down() {},
};
