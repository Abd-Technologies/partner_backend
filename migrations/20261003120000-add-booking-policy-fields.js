'use strict';

// Consultation change policy (Oct 2026):
//   • Reschedule freely until 24 hours before the session.
//   • Inside 24 hours: no reschedule. ONE late change per package —
//     either a late cancel or a missed session — is free.
//   • A second late miss locks self-booking until staff help her rebook.
//
// UserPlans.lateChangeUsedAt — when her one free late change was used
//                               (null = still available).
// UserPlans.bookingLockedAt  — set when she misses after using it; blocks
//                               self-booking until staff reset it.
//
// Appointments.noShowBonusDays — free days added to her package when the
//                               dietitian missed this session (0 = none).
//
// Also adds Appointments.clientNoShowAt, which the model and code already
// use but which never had a migration (live DBs would fail on every
// appointment query without it).
//
// Idempotent — safe to run more than once.

function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const plans = await queryInterface.describeTable('UserPlans');
    if (!hasColumn(plans, 'lateChangeUsedAt')) {
      await queryInterface.addColumn('UserPlans', 'lateChangeUsedAt', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
    if (!hasColumn(plans, 'bookingLockedAt')) {
      await queryInterface.addColumn('UserPlans', 'bookingLockedAt', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
    const appts = await queryInterface.describeTable('Appointments');
    if (!hasColumn(appts, 'clientNoShowAt')) {
      await queryInterface.addColumn('Appointments', 'clientNoShowAt', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
    if (!hasColumn(appts, 'reminderSentAt')) {
      await queryInterface.addColumn('Appointments', 'reminderSentAt', {
        type: Sequelize.DATE,
        allowNull: true,
        defaultValue: null,
      });
    }
    if (!hasColumn(appts, 'noShowBonusDays')) {
      await queryInterface.addColumn('Appointments', 'noShowBonusDays', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      });
    }
  },

  async down(queryInterface) {
    const plans = await queryInterface.describeTable('UserPlans');
    if (hasColumn(plans, 'lateChangeUsedAt')) {
      await queryInterface.removeColumn('UserPlans', 'lateChangeUsedAt');
    }
    if (hasColumn(plans, 'bookingLockedAt')) {
      await queryInterface.removeColumn('UserPlans', 'bookingLockedAt');
    }
    const appts = await queryInterface.describeTable('Appointments');
    if (hasColumn(appts, 'noShowBonusDays')) {
      await queryInterface.removeColumn('Appointments', 'noShowBonusDays');
    }
    if (hasColumn(appts, 'reminderSentAt')) {
      await queryInterface.removeColumn('Appointments', 'reminderSentAt');
    }
    // clientNoShowAt is left in place on purpose (code depends on it).
  },
};
