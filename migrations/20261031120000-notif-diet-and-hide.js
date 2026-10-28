'use strict';

// Audit fixes (Oct 2026). Idempotent: safe on every start.
//   NotificationPreferences.dietUpdates  "Diet plan updates" switch, now on the server
//   UserNotifications.hiddenAt           bell item she swiped away (hidden, not deleted)
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const prefs = await queryInterface.describeTable('NotificationPreferences');
    if (!hasColumn(prefs, 'dietUpdates')) {
      await queryInterface.addColumn('NotificationPreferences', 'dietUpdates', {
        type: Sequelize.INTEGER, allowNull: false, defaultValue: 1,
      });
    }
    const notes = await queryInterface.describeTable('UserNotifications');
    if (!hasColumn(notes, 'hiddenAt')) {
      await queryInterface.addColumn('UserNotifications', 'hiddenAt', {
        type: Sequelize.DATE, allowNull: true,
      });
    }
  },
  async down() {},
};
