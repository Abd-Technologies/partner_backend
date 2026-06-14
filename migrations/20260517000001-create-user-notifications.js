'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('UserNotifications', {
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
      type: {
        type: Sequelize.STRING(80),
        allowNull: false,
        defaultValue: 'general',
      },
      title: {
        type: Sequelize.STRING(255),
        allowNull: false,
        defaultValue: '',
      },
      body: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      data: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      deviceToken: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      deliveryStatus: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: 'sent',
      },
      errorCode: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      errorMessage: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      sentAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      readAt: {
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

    await queryInterface.addIndex('UserNotifications', ['userId', 'sentAt']);
    await queryInterface.addIndex('UserNotifications', ['type']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('UserNotifications');
  },
};
