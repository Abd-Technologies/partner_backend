'use strict';

// Idempotent createTable — guarded by showAllTables() so a re-run
// (or a dev DB where db.sequelize.sync() already created the table)
// doesn't error.

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => t.toLowerCase()).includes('dietplans');
    if (exists) return;

    await queryInterface.createTable('DietPlans', {
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
      userPlanId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'UserPlans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      dietitianId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      aiGenerationLogId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'AIGenerationLogs', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      planDays: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      mealsPerDay: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('draft', 'active', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      activatedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelledAt: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.addIndex('DietPlans', ['userId']);
    await queryInterface.addIndex('DietPlans', ['userPlanId']);
    await queryInterface.addIndex('DietPlans', ['dietitianId']);
    await queryInterface.addIndex('DietPlans', ['userId', 'status']);
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => t.toLowerCase()).includes('dietplans');
    if (exists) {
      await queryInterface.dropTable('DietPlans');
    }
  },
};
