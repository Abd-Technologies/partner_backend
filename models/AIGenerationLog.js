// Audit row written for every Vertex AI Gemini call made via
// services/ai/aiDietPlanGenerator.js. Always written — success and
// failure — so we can debug prompt regressions and track token spend.
module.exports = (sequelize, DataTypes) => {
  const AIGenerationLog = sequelize.define('AIGenerationLog', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    dietitianId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    model: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    planDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    mealsPerDay: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    success: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    inputPrompt: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    rawResponse: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    // JSON-stringified array of validator error strings.
    validationErrors: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    latencyMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    tokensInput: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    tokensOutput: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  });

  AIGenerationLog.associate = (models) => {
    if (models.User) {
      AIGenerationLog.belongsTo(models.User, {
        as: 'targetUser',
        foreignKey: 'userId',
      });
      AIGenerationLog.belongsTo(models.User, {
        as: 'dietitian',
        foreignKey: 'dietitianId',
      });
    }
  };

  return AIGenerationLog;
};
