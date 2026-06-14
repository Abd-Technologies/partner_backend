"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ClassPresences", {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      slotId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Slots", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      meetingNumber: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      source: {
        type: Sequelize.STRING(32),
        allowNull: false,
        defaultValue: "zoom_native",
      },
      joinedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      lastSeenAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      leftAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      durationSeconds: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      attendanceMarkedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("ClassPresences", ["userId", "slotId", "leftAt"], {
      name: "class_presence_user_slot_open_idx",
    });
    await queryInterface.addIndex("ClassPresences", ["slotId", "joinedAt"], {
      name: "class_presence_slot_joined_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ClassPresences");
  },
};
