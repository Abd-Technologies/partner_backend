'use strict';

// Sign-up questions finished or not (Oct 2026).
//   Users.onboardingDoneAt     when she finished the 6 sign-up questions
//   Users.onboardingStep       last question page she reached (0-5)
//   Users.onboardingReminderAt when the one "finish setting up" push went out
//
// First run only (column just added): everyone who is clearly past sign-up
// is marked done, so nobody old is sent back to the questions:
//   staff, paid clients, accounts older than 30 days, and recent accounts
//   that already saved a goal and age.
// Idempotent — safe on every start.
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.describeTable('Users');
    const added = !hasColumn(users, 'onboardingDoneAt');
    if (added) {
      await queryInterface.addColumn('Users', 'onboardingDoneAt', { type: Sequelize.DATE, allowNull: true });
    }
    if (!hasColumn(users, 'onboardingStep')) {
      await queryInterface.addColumn('Users', 'onboardingStep', { type: Sequelize.INTEGER, allowNull: true });
    }
    if (!hasColumn(users, 'onboardingReminderAt')) {
      await queryInterface.addColumn('Users', 'onboardingReminderAt', { type: Sequelize.DATE, allowNull: true });
    }
    if (added) {
      await queryInterface.sequelize.query(`
        UPDATE Users SET onboardingDoneAt = createdAt
        WHERE onboardingDoneAt IS NULL AND (
          userType <> 'User'
          OR status = 1
          OR createdAt < (NOW() - INTERVAL 30 DAY)
          OR (mainGoal IS NOT NULL AND mainGoal <> '' AND age IS NOT NULL AND age <> '')
        )`);
    }
  },
  async down(queryInterface) {
    const users = await queryInterface.describeTable('Users');
    for (const c of ['onboardingDoneAt', 'onboardingStep', 'onboardingReminderAt']) {
      if (hasColumn(users, c)) await queryInterface.removeColumn('Users', c);
    }
  },
};
