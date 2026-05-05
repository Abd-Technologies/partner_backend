module.exports = (sequelize, DataTypes) => {
  const PcosScreening = sequelize.define('PcosScreening', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    riskLevel: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    riskScore: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    q1_periods: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    q2_hairGrowth: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    q3_weightLoss: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    q4_skinAcne: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    q5_hormoneTests: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });

  PcosScreening.associate = (models) => {
    PcosScreening.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return PcosScreening;
};
