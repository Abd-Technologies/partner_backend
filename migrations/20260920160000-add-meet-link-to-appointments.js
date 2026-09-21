'use strict';

// Adds a per-appointment `meetLink` snapshot column.
//
// Why this is needed: the Meet link a client sees actually lives on
// SlotDiet (the recurring weekly slot template — e.g. "Monday 3-4 PM"),
// shared by every appointment ever booked into that slot, across every
// week. That's fine for read-time convenience, but it means updating a
// slot's link live-affects every currently-confirmed-but-not-yet-
// happened appointment against it, even ones for a different future
// week/client than the one the dietitian meant to change it for.
//
// `meetLink` fixes that: the moment a booking is confirmed, whatever
// link is on its slot at that instant gets copied here, onto the
// appointment itself. From then on this specific booking reads its own
// frozen copy, not the live slot value — a later edit to the slot's
// link only affects appointments confirmed after that edit, never one
// already locked in. Null until confirmed (or for legacy rows created
// before this existed); consumers should fall back to
// SlotDiet.dietitionLink when this is null, for backward compatibility.
//
// Idempotent — safe to run more than once.

function findColumnKey(tableDescription, lowerName) {
  return Object.keys(tableDescription).find(
    (k) => k.toLowerCase() === lowerName
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Appointments');
    if (!findColumnKey(table, 'meetlink')) {
      await queryInterface.addColumn('Appointments', 'meetLink', {
        type: Sequelize.TEXT('long'),
        allowNull: true,
        defaultValue: null,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Appointments');
    const existingKey = findColumnKey(table, 'meetlink');
    if (existingKey) {
      await queryInterface.removeColumn('Appointments', existingKey);
    }
  },
};
