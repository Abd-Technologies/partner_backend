'use strict';

// Growth analytics (Oct 2026) — add-only columns, never changes a flow.
//   Users.signupMethod   email / google / apple
//   Users.signupSource   where she came from (rep_link, instagram, organic…)
//   Users.signupCampaign utm campaign from the install link, if any
//   Users.lastLoginAt    last successful login (password or Google/Apple)
//   Users.loginCount     how many successful logins
// New TABLES (UserActiveDays, ClassSessions, PlanPurchases, PaymentAttempts)
// are created by sequelize.sync() from their models.
//
// Idempotent — safe on every start.
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const users = await queryInterface.describeTable('Users');
    const cols = [
      ['signupMethod', { type: Sequelize.STRING(16), allowNull: true }],
      ['signupSource', { type: Sequelize.STRING(40), allowNull: true }],
      ['signupCampaign', { type: Sequelize.STRING(80), allowNull: true }],
      ['lastLoginAt', { type: Sequelize.DATE, allowNull: true }],
      ['loginCount', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }],
    ];
    for (const [name, def] of cols) {
      if (!hasColumn(users, name)) await queryInterface.addColumn('Users', name, def);
    }
    // Symptom check: when her dietitian was told about a result.
    try {
      const hs = await queryInterface.describeTable('HealthScreenings');
      if (!hasColumn(hs, 'dietitianNotifiedAt')) {
        await queryInterface.addColumn('HealthScreenings', 'dietitianNotifiedAt', { type: Sequelize.DATE, allowNull: true });
      }
    } catch (_) { /* table created later by sync() with the column */ }
  },
  async down(queryInterface) {
    const users = await queryInterface.describeTable('Users');
    for (const c of ['signupMethod', 'signupSource', 'signupCampaign', 'lastLoginAt', 'loginCount']) {
      if (hasColumn(users, c)) await queryInterface.removeColumn('Users', c);
    }
  },
};
