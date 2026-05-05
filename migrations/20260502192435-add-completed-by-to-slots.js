'use strict';

// Adds two columns to Slots so we can distinguish "trainer ended manually"
// from "auto-end cron fired". This is the audit signal documented in
// docs/Slot_Status_Audit_Signals.md — without it, both paths produce an
// indistinguishable Completed row and the trainer-engagement quality
// signal is lost.
//
// completed_by      : nullable INT FK to Users. Populated when the
//                     updateSlotStatus endpoint flips status to Completed
//                     (or Cancelled). NULL = the auto-end cron set it.
// status_changed_at : timestamp of the most recent status flip. Lets the
//                     audit query order by "when did we lose touch" and
//                     makes manual-vs-auto distinguishable even after a
//                     second flip.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Slots', 'completed_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('Slots', 'status_changed_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Slots', 'completed_by');
    await queryInterface.removeColumn('Slots', 'status_changed_at');
  },
};
