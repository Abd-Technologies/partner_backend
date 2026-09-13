'use strict';

/**
 * Trial-to-Plan funnel (Step 2 + Step 3 groundwork) — see the published
 * "Trial-to-Plan Funnel" design artifact.
 *
 * 1. UserPlans.isTrial — DietPlan.userPlanId is NOT NULL, so a free-trial
 *    user needs *some* UserPlan row to hang an auto-generated diet plan
 *    off of. This flag marks that row as a system placeholder (zero
 *    price, not a real subscription) so:
 *      - popupEligibility.js can exclude it from Day15/30 progress and
 *        renewal/follow-up-consultation popups (those assume a paid
 *        subscription cycle) while still letting it satisfy the
 *        "user has an active plan" gate for the daily-log reminder.
 *      - Any future admin/reporting view can tell a real purchase from
 *        this internal bookkeeping row at a glance.
 *
 * 2. PreConsultationProfiles.intakeSource — records whether a profile
 *    came from the full dietitian-facing consultation form or the
 *    trimmed 3-field trial quick-intake. Nullable/untouched for every
 *    existing row (all of those came from the full form). This exists
 *    so a later "upgrade to paid" flow can tell a trial user still owes
 *    a real consultation rather than assuming isComplete=true means the
 *    full intake already happened.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('UserPlans', 'isTrial', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    await queryInterface.addColumn('PreConsultationProfiles', 'intakeSource', {
      type: Sequelize.STRING(32),
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('UserPlans', 'isTrial');
    await queryInterface.removeColumn('PreConsultationProfiles', 'intakeSource');
  },
};
