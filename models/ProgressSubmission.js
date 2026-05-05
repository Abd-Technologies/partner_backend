module.exports = (sequelize, DataTypes) => {
  // Day 15 / Day 30 mandatory progress submission. Photos are NEVER stored
  // here — they live device-only per Section 10. UI lets the user toggle
  // an in-app "I included photos" indicator for their own records, but no
  // bytes leave the device.
  const ProgressSubmission = sequelize.define(
    'ProgressSubmission',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userPlanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // 15 or 30 — the day-of-plan checkpoint.
      cycle: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      weightKg: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      waistCm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      hipsCm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      chestCm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      armsCm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      thighsCm: {
        type: DataTypes.FLOAT,
        allowNull: true,
      },
      // Diet-side
      clothesFit: {
        type: DataTypes.ENUM('tighter', 'same', 'looser'),
        allowNull: true,
      },
      sleepQuality: {
        type: DataTypes.INTEGER, // 1..5
        allowNull: true,
      },
      satisfaction: {
        type: DataTypes.INTEGER, // 1..5
        allowNull: true,
      },
      // Workout-side free-text or guided prompts.
      strengthNotes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      submittedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: 'ProgressSubmissions',
      timestamps: true,
      indexes: [
        // Dietitian dashboard: "show me this user's progress submissions
        // across cycles ordered by date."
        { fields: ['userId', 'submittedAt'] },
        // Uniqueness so we don't double-submit the same checkpoint.
        { unique: true, fields: ['userPlanId', 'cycle'] },
      ],
    }
  );

  ProgressSubmission.associate = (models) => {
    ProgressSubmission.belongsTo(models.User, { foreignKey: 'userId' });
    ProgressSubmission.belongsTo(models.UserPlan, { foreignKey: 'userPlanId' });
  };

  return ProgressSubmission;
};
