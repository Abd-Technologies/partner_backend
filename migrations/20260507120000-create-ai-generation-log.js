'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AIGenerationLogs', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      dietitianId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      model: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      planDays: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      mealsPerDay: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      success: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      inputPrompt: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
      },
      rawResponse: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
      },
      validationErrors: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      latencyMs: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      tokensInput: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      tokensOutput: {
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('AIGenerationLogs', ['userId']);
    await queryInterface.addIndex('AIGenerationLogs', ['dietitianId']);
    await queryInterface.addIndex('AIGenerationLogs', ['createdAt']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AIGenerationLogs');
  },
};
