module.exports = (sequelize, DataTypes) => {
  const HealthScreening = sequelize.define('HealthScreening', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    conditionType: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'PCOS, Thyroid, Menopause, Postpartum, Endometriosis',
    },
    riskLevel: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'high, moderate, low',
    },
    riskScore: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    answers: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'JSON string of all question answers',
    },
    // When her dietitian was told about this result ("Tell my dietitian",
    // or automatically when signs went up). Migration 20261020120000.
    dietitianNotifiedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  HealthScreening.associate = (models) => {
    HealthScreening.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return HealthScreening;
};
