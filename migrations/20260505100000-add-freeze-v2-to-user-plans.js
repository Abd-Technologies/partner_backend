'use strict';

// Adds the freeze-v2 columns to UserPlans. See
// docs/Freeze_Logic_Audit.md for the full design. The new user-button
// flow (POST /users/plan/freeze, /unfreeze, /freeze-status) uses only
// these columns; the legacy admin endpoint (POST /admin/freeze) keeps
// using the User.freeze / freezingDays / usedFreezeOption columns
// untouched. Both can coexist — frozenAt IS NULL is the canonical
// "not frozen" check for the new flow.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('UserPlans', 'frozenAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'freezeDays', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'totalFrozenDays', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('UserPlans', 'originalDurationDays', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'lastUnfrozenAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'frozenBy', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('UserPlans', 'unfrozenBy', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('UserPlans', 'unfrozenBy');
    await queryInterface.removeColumn('UserPlans', 'frozenBy');
    await queryInterface.removeColumn('UserPlans', 'lastUnfrozenAt');
    await queryInterface.removeColumn('UserPlans', 'originalDurationDays');
    await queryInterface.removeColumn('UserPlans', 'totalFrozenDays');
    await queryInterface.removeColumn('UserPlans', 'freezeDays');
    await queryInterface.removeColumn('UserPlans', 'frozenAt');
  },
};
