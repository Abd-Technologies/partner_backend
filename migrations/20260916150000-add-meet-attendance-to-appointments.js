'use strict';

// Adds attendance-tracking columns to Appointments, populated by the new
// Google Meet attendance check (services/meetAttendance). After a
// consultation's scheduled time passes, a cron job looks up the real
// Meet conference record for that appointment (matched by the SlotDiet's
// dietitionLink + the appointment's time window) and records who
// actually joined — instead of guessing from whether the dietitian
// remembered to flip Appointment.status.
//
//   meetAttendanceCheckedAt — when we last tried the lookup (null =
//     never checked yet, either too soon or no link on file).
//   meetDietitianAttended / meetClientAttended — nullable booleans.
//     Null means "we couldn't determine this" (e.g. no conference
//     record found at all), not "false" — keep that distinction in any
//     UI built on top of this.
//   meetConferenceRecordName — Google's own record id, kept for
//     debugging/support ("what did we actually match this to").
//   meetAttendanceRaw — full raw participant list as JSON text, so we
//     can refine the attended/not-attended heuristic later without
//     another migration or losing the underlying data.
//
// Idempotent — safe to run more than once, and safe even if a future
// sync() ever creates one of these columns first.

function findColumnKey(tableDescription, lowerName) {
  return Object.keys(tableDescription).find(
    (k) => k.toLowerCase() === lowerName
  );
}

const COLUMNS = [
  ['meetAttendanceCheckedAt', (Sequelize) => ({ type: Sequelize.DATE, allowNull: true, defaultValue: null })],
  ['meetDietitianAttended', (Sequelize) => ({ type: Sequelize.BOOLEAN, allowNull: true, defaultValue: null })],
  ['meetClientAttended', (Sequelize) => ({ type: Sequelize.BOOLEAN, allowNull: true, defaultValue: null })],
  ['meetConferenceRecordName', (Sequelize) => ({ type: Sequelize.STRING(255), allowNull: true, defaultValue: null })],
  ['meetAttendanceRaw', (Sequelize) => ({ type: Sequelize.TEXT('long'), allowNull: true, defaultValue: null })],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Appointments');
    for (const [name, def] of COLUMNS) {
      if (!findColumnKey(table, name.toLowerCase())) {
        await queryInterface.addColumn('Appointments', name, def(Sequelize));
      }
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Appointments');
    for (const [name] of COLUMNS) {
      const existingKey = findColumnKey(table, name.toLowerCase());
      if (existingKey) {
        await queryInterface.removeColumn('Appointments', existingKey);
      }
    }
  },
};
