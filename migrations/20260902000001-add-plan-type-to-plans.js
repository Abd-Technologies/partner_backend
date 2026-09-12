'use strict';

// Single authoritative field for "is this plan diet / workout / combined".
// Before this, four different places in the codebase each guessed this
// independently and disagreed with each other:
//   - day7ReviewController.js trusted whatever the client sent, unverified
//   - userController.js queried Category.title === "WorkOut"
//   - AdminController.js queried Category.title === "Workout" (different
//     casing — at most one of these two ever matched a real row)
//   - AdminController.js separately queried Category.title === "Diet"
//   - popupEligibility.js guessed from a substring match on Plan.title
// planType replaces all of that with one column, set once per catalog
// plan (there are only a handful of Plan rows — this is not a per-user
// migration, existing UserPlan/client data is untouched).
//
// Nullable and unused until backfilled — see scripts/list_plans_for_labeling.js
// for pulling the existing catalog so a human can confirm each value
// before the call sites are switched over to rely on it.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Plans');

    if (!table.planType) {
      await queryInterface.addColumn('Plans', 'planType', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('Plans');
    if (table.planType) {
      await queryInterface.removeColumn('Plans', 'planType');
    }
  },
};
