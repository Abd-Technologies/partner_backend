'use strict';

// Class rooms (Oct 2026):
//   Users.zoomRoom        — trainer's permanent Zoom meeting number, set
//                           once by admin. Every class she teaches uses it.
//   Slots.backupLink      — trainer's "Other link" (e.g. Google Meet) for
//   Slots.backupLinkDate    ONE day only (PKT date "YYYY-MM-DD"). Ignored
//                           on any other day, so the class goes back to
//                           her Zoom room on its own.
// Slots.trainerLink stays: the server keeps it equal to the trainer's
// zoomRoom (it's a copy, the trainer profile is the truth).
//
// Idempotent — safe to run more than once.
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.describeTable('Users');
    if (!hasColumn(users, 'zoomRoom')) {
      await queryInterface.addColumn('Users', 'zoomRoom', { type: Sequelize.STRING(32), allowNull: true });
    }
    // App update push: last app version each user opened.
    for (const [col, type] of [['appVersion', Sequelize.STRING(20)], ['appPlatform', Sequelize.STRING(10)], ['appVersionAt', Sequelize.DATE]]) {
      if (!hasColumn(users, col)) await queryInterface.addColumn('Users', col, { type, allowNull: true });
    }
    const slots = await queryInterface.describeTable('Slots');
    if (!hasColumn(slots, 'backupLink')) {
      await queryInterface.addColumn('Slots', 'backupLink', { type: Sequelize.TEXT, allowNull: true });
    }
    if (!hasColumn(slots, 'backupLinkDate')) {
      await queryInterface.addColumn('Slots', 'backupLinkDate', { type: Sequelize.STRING(10), allowNull: true });
    }
  },
  async down(queryInterface) {
    const users = await queryInterface.describeTable('Users');
    if (hasColumn(users, 'zoomRoom')) await queryInterface.removeColumn('Users', 'zoomRoom');
    const slots = await queryInterface.describeTable('Slots');
    if (hasColumn(slots, 'backupLink')) await queryInterface.removeColumn('Slots', 'backupLink');
    if (hasColumn(slots, 'backupLinkDate')) await queryInterface.removeColumn('Slots', 'backupLinkDate');
  },
};
