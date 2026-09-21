'use strict';

// Adds Users.weightGoalDirection — nullable STRING, 'lose' | 'gain' | null.
// Lets the home screen's Weight trend card color-code a week-over-week
// change correctly: a signup mainGoal of "Lose weight" already implies
// direction, but "Build strength & tone" / "Improve fitness" / "Reduce
// stress" (and no goal at all) don't say anything about weight direction
// on their own — this column lets the user answer that specifically when
// they set a target weight, instead of the trend guessing.
//
// Idempotent — db.sequelize.sync() on app boot may already have created
// this column from the User model definition by the time this migration
// runs in a given environment; skip addColumn if it's already there.

function findColumnKey(tableDescription, lowerName) {
  return Object.keys(tableDescription).find(
    (k) => k.toLowerCase() === lowerName
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Users');
    if (!findColumnKey(table, 'weightgoaldirection')) {
      await queryInterface.addColumn('Users', 'weightGoalDirection', {
        type: Sequelize.STRING(10),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Users');
    const existingKey = findColumnKey(table, 'weightgoaldirection');
    if (existingKey) {
      await queryInterface.removeColumn('Users', existingKey);
    }
  },
};
