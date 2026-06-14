'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('NotificationPreferences', 'timeBlock', {
      type: Sequelize.ENUM('morning', 'afternoon', 'evening', 'night', 'all'),
      allowNull: false,
      defaultValue: 'all',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('NotificationPreferences', 'timeBlock');
    await queryInterface.sequelize.query(
      "DROP TYPE IF EXISTS enum_NotificationPreferences_timeBlock;"
    );
  },
};
