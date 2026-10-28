module.exports = (sequelize, DataTypes) => {
  const WeeklyCheckin = sequelize.define('WeeklyCheckin', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    weekDate: {
      type: DataTypes.STRING,
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
    hipCm: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
    weekRating: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // One weekly check-in (Oct 2026, helper/weeklyCheckin.js). Columns are
    // added on start by migrations/20261030120000-weekly-checkin-v2.js.
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
    // Which package and which check-in (7, 14, 21, 28...). Null on rows
    // from the old weight log / sign-up.
    userPlanId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    checkinDay: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    // Diet / workout answers and the halfway / end answers, as she gave
    // them (also saved to Day7Review / ProgressSubmission).
    planAnswers: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    milestoneAnswers: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    indexes: [
      {
        unique: true,
        fields: ['userId', 'weekDate'],
      },
    ],
  });

  WeeklyCheckin.associate = (models) => {
    WeeklyCheckin.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return WeeklyCheckin;
};
