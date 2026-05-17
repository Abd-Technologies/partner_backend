'use strict';

// Bring Users.timeZone up to spec: STRING(50) NOT NULL DEFAULT
// 'Asia/Karachi' (was nullable STRING with no default).
//
// Idempotent — does case-insensitive column lookup so it tolerates the
// legacy camelCase `timeZone` column already created by
// db.sequelize.sync(). On a clean DB it adds the column from scratch.
//
// We keep the existing camelCase name (`timeZone`) instead of renaming
// to `timezone` because controllers/Admin/AdminController.js,
// controllers/FrontSite/DashboardController.js, and
// helper/crownjobfunction.js already reference `user.timeZone`. The
// Phase B spec said "don't modify controllers"; a rename here would
// require changes there.

const COLUMN_LOOKUP = 'timezone'; // case-insensitive match for either casing.

function findColumnKey(tableDescription, lowerName) {
  return Object.keys(tableDescription).find(
    (k) => k.toLowerCase() === lowerName
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('Users');
    const existingKey = findColumnKey(table, COLUMN_LOOKUP);

    if (existingKey) {
      // Backfill BEFORE flipping NOT NULL; otherwise rows with NULL
      // values would block the changeColumn.
      await queryInterface.sequelize.query(
        "UPDATE `Users` SET `" +
          existingKey +
          "` = 'Asia/Karachi' WHERE `" +
          existingKey +
          "` IS NULL OR `" +
          existingKey +
          "` = ''"
      );
      await queryInterface.changeColumn('Users', existingKey, {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'Asia/Karachi',
      });
    } else {
      await queryInterface.addColumn('Users', 'timeZone', {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'Asia/Karachi',
      });
      await queryInterface.sequelize.query(
        "UPDATE `Users` SET `timeZone` = 'Asia/Karachi' WHERE `timeZone` IS NULL OR `timeZone` = ''"
      );
    }
  },

  async down(queryInterface, Sequelize) {
    // Reversal: relax the column back to nullable STRING. We don't drop
    // it — pre-existing data + controller callers depend on it.
    const table = await queryInterface.describeTable('Users');
    const existingKey = findColumnKey(table, COLUMN_LOOKUP);
    if (existingKey) {
      await queryInterface.changeColumn('Users', existingKey, {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: null,
      });
    }
  },
};
