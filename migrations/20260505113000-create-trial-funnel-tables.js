'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TrialTokens', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      token: {
        type: Sequelize.STRING(191),
        allowNull: false,
        unique: true,
      },
      issuedForPhone: {
        type: Sequelize.STRING(72),
        allowNull: true,
      },
      issuedForEmail: {
        type: Sequelize.STRING(191),
        allowNull: true,
      },
      referrerUserId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      usedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      usedByUserId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.ENUM('issued', 'used', 'expired', 'revoked'),
        allowNull: false,
        defaultValue: 'issued',
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
    await queryInterface.addIndex('TrialTokens', ['token'], {
      name: 'trial_tokens_token_unique',
      unique: true,
    });

    await queryInterface.createTable('TrialJourneys', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        unique: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      trialTokenId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'TrialTokens', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      state: {
        type: Sequelize.STRING(64),
        allowNull: false,
        defaultValue: 'trial_started',
      },
      nextBookableDay: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      tokenValidatedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      startedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      day1SlotId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Slots', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      day1BookedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      day1AttendedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      day1AttendedMinutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      day2SlotId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Slots', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      day2BookedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      day2AttendedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      day2AttendedMinutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      day3SlotId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Slots', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      day3BookedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      day3AttendedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      day3AttendedMinutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      convertedAt: {
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
    await queryInterface.addIndex('TrialJourneys', ['userId'], {
      name: 'trial_journeys_user_unique',
      unique: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('TrialJourneys');
    await queryInterface.dropTable('TrialTokens');
  },
};
