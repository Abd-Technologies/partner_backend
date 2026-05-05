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
