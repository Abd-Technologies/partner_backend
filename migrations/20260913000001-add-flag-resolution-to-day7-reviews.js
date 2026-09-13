'use strict';

// Day7Review.flagged is computed server-side on every save (see the
// beforeSave hook in models/Day7Review.js) from the review's own raw
// fields (adherencePct, painReported, severeSideEffectsReported,
// satisfaction). That hook re-derives `flagged` from those fields on
// EVERY save, including a plain `.update()` — so there is no way to
// "clear" a flag by writing `flagged: false`; the very next save (even
// an unrelated one) would immediately flip it back to true as long as
// the underlying numbers still cross the threshold.
//
// What was actually missing was a way to record "a human looked at
// this and dealt with it" as a fact independent of the computed flag.
// These two columns mirror the existing PendingPopupState.completedAt
// pattern (and UserPlan's frozenAt/frozenBy, cancelledAt/cancelledBy
// audit pairs) rather than inventing a new convention: a timestamp and
// the staff id who acknowledged it. `flagged` stays the immutable
// "did this review trip a threshold" fact; `flagResolvedAt` is the
// separate "has this been dealt with" fact the dietitian queue and
// escalation-resolve flow now filter/write against.
//
// Guarded with describeTable so this is safe to run even if a column
// already exists on a given environment (same pattern as
// 20260905000001-add-cancellation-fields-to-user-plans.js).
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Day7Reviews');

    if (!table.flagResolvedAt) {
      await queryInterface.addColumn('Day7Reviews', 'flagResolvedAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
    if (!table.flagResolvedBy) {
      await queryInterface.addColumn('Day7Reviews', 'flagResolvedBy', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('Day7Reviews');
    if (table.flagResolvedBy) {
      await queryInterface.removeColumn('Day7Reviews', 'flagResolvedBy');
    }
    if (table.flagResolvedAt) {
      await queryInterface.removeColumn('Day7Reviews', 'flagResolvedAt');
    }
  },
};
