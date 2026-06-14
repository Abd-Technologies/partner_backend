module.exports = (sequelize, DataTypes) => {
  const ClassPresence = sequelize.define(
    "ClassPresence",
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      slotId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      meetingNumber: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      source: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "zoom_native",
      },
      joinedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      lastSeenAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      leftAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      durationSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      attendanceMarkedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "ClassPresences",
      timestamps: true,
    }
  );

  ClassPresence.associate = (models) => {
    ClassPresence.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
    });
    ClassPresence.belongsTo(models.Slot, {
      foreignKey: "slotId",
      as: "slot",
    });
  };

  return ClassPresence;
};
