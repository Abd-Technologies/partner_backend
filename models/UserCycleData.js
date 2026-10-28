module.exports = (sequelize, DataTypes) => {
  const UserCycleData = sequelize.define('UserCycleData', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
    },
    lastPeriodDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    averageCycleLength: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 28,
    },
    isRegular: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    periodDuration: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    flowType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    currentCycleDay: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    currentPhase: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    dataProvided: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    // Oct 2026: her real cycle lengths (days between two logged period
    // starts), newest last, up to 6. JSON text. See helper/cycleLearning.js.
    cycleHistory: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  UserCycleData.associate = (models) => {
    UserCycleData.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return UserCycleData;
};
