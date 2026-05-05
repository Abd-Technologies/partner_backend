'use strict';

// Phase A — Progress Screen rebuild. Mirrors the existing useNewPaidHome /
// useNewUnpaidHome feature-flag pattern. Defaults false so production users
// stay on the legacy progress_screen.dart until product opts them in.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'useNewProgressHub', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'useNewProgressHub');
  },
};
