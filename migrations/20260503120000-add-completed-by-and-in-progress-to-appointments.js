'use strict';

// Mirrors the Slot audit signal pattern (see migration
// 20260502192435-add-completed-by-to-slots) for dietitian Appointments.
//
// Adds:
//   • In Progress to status enum — explicit "session is live" state set by
//     the new POST /appointment/:id/start endpoint. Without it, the cron
//     can't tell a confirmed-but-no-show appointment from a confirmed
//     session that ran late, so a no-show would be silently auto-completed.
//   • completed_by      : nullable INT FK to Users. Populated when manual
//                         endpoints flip status. NULL = the auto-end cron set it.
//   • status_changed_at : timestamp of the most recent status flip. Lets the
//                         audit query rank events on the audit dashboard.
//
// MySQL ENUM ALTER reorders/adds via raw SQL — Sequelize's changeColumn
// regenerates the ENUM clause and works on MySQL 5.7+/8.x but is fussy
// across drivers. Using raw ALTER for the enum is more predictable.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(
      "ALTER TABLE `Appointments` MODIFY COLUMN `status` " +
        "ENUM('pending','confirmed','In Progress','completed','canceled','canceledByUser') " +
        "DEFAULT 'pending'"
    );

    await queryInterface.addColumn('Appointments', 'completed_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn('Appointments', 'status_changed_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Appointments', 'status_changed_at');
    await queryInterface.removeColumn('Appointments', 'completed_by');

    // Revert enum. Any rows currently in 'In Progress' must be moved out
    // first or the ALTER will fail. We coerce them to 'confirmed' since
    // that's the pre-Start state.
    await queryInterface.sequelize.query(
      "UPDATE `Appointments` SET `status` = 'confirmed' WHERE `status` = 'In Progress'"
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE `Appointments` MODIFY COLUMN `status` " +
        "ENUM('pending','confirmed','completed','canceled','canceledByUser') " +
        "DEFAULT 'pending'"
    );
  },
};
