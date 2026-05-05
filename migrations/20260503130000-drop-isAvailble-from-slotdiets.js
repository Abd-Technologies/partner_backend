'use strict';

// Drops the `isAvailble` column on SlotDiets. It had three problems:
//   1. typo (should have been "isAvailable")
//   2. wrong default syntax (`default: true` instead of `defaultValue: true`)
//      so new rows were getting NULL, not true
//   3. nothing ever wrote or read it — addOrUpdateDaySlot wrote
//      `isAvailable: 1` (without the typo, an unknown attribute that
//      Sequelize silently dropped) and the booking check uses the
//      Appointment table to determine availability
//
// Removing the column is safer than fixing the typo: if a future feature
// needs per-slot availability, it should be reintroduced deliberately
// with a clear contract for who writes it and when.
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('SlotDiets', 'isAvailble');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('SlotDiets', 'isAvailble', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: null,
    });
  },
};
