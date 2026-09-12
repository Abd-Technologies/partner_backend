'use strict';

// Splits the dietitian-review-completion signal off of UserPlan.planStatus
// into its own column. Before this, both concepts wrote to the same
// `planStatus` string:
//   - AdminController.js completeDietPlan / addDietitionReview set it to
//     the literal "completed" (via process.env.PLANSTATUS) whenever a
//     dietitian finished writing/reviewing a diet plan document.
//   - helper/autoExpireUserPlans.js (added 2026-09-01) started writing
//     "expired" to the same column when a subscription's expireDate
//     passed.
// Those are two unrelated lifecycles (diet-plan-content review vs.
// subscription time expiry) sharing one field, which meant a plan that
// was already reviewed-complete could never be flagged expired later
// without losing that history. This gives the diet-plan-review signal
// its own column so `planStatus` can stay dedicated to the
// subscription/package lifecycle (expired, and future states like
// cancelled/active) going forward.
//
// Guards with describeTable (see 20260728120000-add-trainer-dietitian-
// to-user-plans.js for the same pattern) so this is safe to run even if
// the column already exists on a given environment.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('UserPlans');

    if (!table.dietPlanStatus) {
      await queryInterface.addColumn('UserPlans', 'dietPlanStatus', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('UserPlans');
    if (table.dietPlanStatus) {
      await queryInterface.removeColumn('UserPlans', 'dietPlanStatus');
    }
  },
};
