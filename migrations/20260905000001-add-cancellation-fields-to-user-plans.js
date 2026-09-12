'use strict';

// Adds a real cancellation trail to UserPlan (the paid subscription row).
// Before this, the only "cancel" action anywhere in the backend
// (AdminController.cancelDietPlan) touched the DietPlan review document,
// never the underlying UserPlan — there was no way to actually cancel an
// active paid subscription server-side at all. AdminController.cancelUserPlan
// (added alongside this migration) is the first thing that writes these.
//
// Mirrors the existing freeze audit columns (frozenAt/frozenBy/unfrozenBy
// from 20260505100000-add-freeze-v2-to-user-plans.js) rather than inventing
// a new convention: a timestamp, an optional free-text reason, and the
// admin id who did it.
//
// Guards with describeTable (see 20260901000001-add-diet-plan-status-to-
// user-plans.js for the same pattern) so this is safe to run even if a
// column already exists on a given environment.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('UserPlans');

    if (!table.cancelledAt) {
      await queryInterface.addColumn('UserPlans', 'cancelledAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!table.cancelReason) {
      await queryInterface.addColumn('UserPlans', 'cancelReason', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
    if (!table.cancelledBy) {
      await queryInterface.addColumn('UserPlans', 'cancelledBy', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('UserPlans');
    if (table.cancelledBy) {
      await queryInterface.removeColumn('UserPlans', 'cancelledBy');
    }
    if (table.cancelReason) {
      await queryInterface.removeColumn('UserPlans', 'cancelReason');
    }
    if (table.cancelledAt) {
      await queryInterface.removeColumn('UserPlans', 'cancelledAt');
    }
  },
};
