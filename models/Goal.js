module.exports = (sequelize, DataTypes) => {
  // Phase A — Progress Screen rebuild. One row per active goal per user.
  // Pre-existing User.targetWeightKg + User.mainGoal are kept (read by
  // PaidHomeV2) but Goal is the new source of truth for pacing and the
  // hero block on the Progress hub.
  const Goal = sequelize.define('Goal', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('weight_loss', 'weight_gain', 'maintain', 'recomp'),
      allowNull: false,
      defaultValue: 'weight_loss',
    },
    startValueKg: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    targetValueKg: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    // Snapshot of the most recent observed weight. Updated by the progress
    // controller on read so unauthenticated/cron paths don't have to.
    currentValueKg: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    targetDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    weeklyClassTarget: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 4,
    },
    // Computed at write time: (target - start) / weeks_between(start, target).
    // Stored so PaceEngine doesn't recompute every read and so historical
    // edits to the goal don't retroactively change pace messages.
    expectedPaceKgPerWeek: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'achieved', 'abandoned'),
      allowNull: false,
      defaultValue: 'active',
    },
  }, {
    indexes: [
      // Most reads are "give me the active goal for this user" — covered
      // index on (userId, status).
      { fields: ['userId', 'status'] },
    ],
  });

  Goal.associate = (models) => {
    Goal.belongsTo(models.User, { foreignKey: 'userId' });
    models.User.hasMany(Goal, { foreignKey: 'userId' });
  };

  return Goal;
};
