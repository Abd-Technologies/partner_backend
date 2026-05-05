module.exports = (sequelize, DataTypes) => {
  const TrialJourney = sequelize.define(
    "TrialJourney",
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      trialTokenId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      state: {
        type: DataTypes.STRING(64),
        allowNull: false,
        defaultValue: "trial_started",
      },
      nextBookableDay: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      tokenValidatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      startedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      day1SlotId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      day1BookedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      day1AttendedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      day1AttendedMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      day2SlotId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      day2BookedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      day2AttendedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      day2AttendedMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      day3SlotId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      day3BookedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      day3AttendedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      day3AttendedMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      convertedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "TrialJourneys",
      timestamps: true,
    }
  );

  TrialJourney.associate = (models) => {
    TrialJourney.belongsTo(models.User, {
      foreignKey: "userId",
      as: "user",
    });
    TrialJourney.belongsTo(models.TrialToken, {
      foreignKey: "trialTokenId",
      as: "trialToken",
    });
    TrialJourney.belongsTo(models.Slot, {
      foreignKey: "day1SlotId",
      as: "day1Slot",
    });
    TrialJourney.belongsTo(models.Slot, {
      foreignKey: "day2SlotId",
      as: "day2Slot",
    });
    TrialJourney.belongsTo(models.Slot, {
      foreignKey: "day3SlotId",
      as: "day3Slot",
    });
  };

  return TrialJourney;
};
