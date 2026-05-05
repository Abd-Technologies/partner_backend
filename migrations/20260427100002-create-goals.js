'use strict';

// Phase A — Progress Screen rebuild. Creates the Goals table; backfilled
// from User.targetWeightKg + earliest WeeklyCheckin.weekDate via
// scripts/backfill_goals.js (run separately after this migration).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Goals', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      type: {
        type: Sequelize.ENUM('weight_loss', 'weight_gain', 'maintain', 'recomp'),
        allowNull: false,
        defaultValue: 'weight_loss',
      },
      startValueKg: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      targetValueKg: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      currentValueKg: {
        type: Sequelize.FLOAT,
        allowNull: true,
      },
      startDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      targetDate: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      weeklyClassTarget: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 4,
      },
      expectedPaceKgPerWeek: {
        type: Sequelize.FLOAT,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('active', 'achieved', 'abandoned'),
        allowNull: false,
        defaultValue: 'active',
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('Goals', ['userId', 'status'], {
      name: 'goals_user_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Goals', 'goals_user_status_idx').catch(() => {});
    await queryInterface.dropTable('Goals');
    // MySQL: drop ENUM types are scoped to the column; nothing extra to clean
    // up. (Postgres would need DROP TYPE — not relevant here.)
  },
};
