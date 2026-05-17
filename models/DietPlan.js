/**
 * DietPlan — header row for one structured diet plan generated for a
 * user. The AI service (services/ai/aiDietPlanGenerator.js) returns
 * `summary + days[]`; Phase C will persist that into this table plus
 * DietPlanDay + DietPlanMeal in a single transaction.
 *
 * Status lifecycle:
 *   draft     → just generated, dietitian hasn't approved yet
 *   active    → dietitian flipped it on; this is the user's live plan
 *   completed → planDays elapsed; archived
 *   cancelled → dietitian replaced or revoked it before completion
 *
 * The legacy PdfDietsForUserNew flow is unaffected — both can coexist
 * during the migration period.
 */
module.exports = (sequelize, DataTypes) => {
  const DietPlan = sequelize.define(
    'DietPlan',
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
      // Caller (the dietitian who triggered generation). NULL for
      // self-service or system-generated plans.
      dietitianId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Traceability link back to the AI run that produced this plan.
      // NULL for plans authored by hand.
      aiGenerationLogId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      planDays: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      mealsPerDay: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('draft', 'active', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      activatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      cancelledAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'DietPlans',
      timestamps: true,
      indexes: [
        { fields: ['userId'] },
        { fields: ['userPlanId'] },
        { fields: ['dietitianId'] },
        { fields: ['userId', 'status'] },
      ],
    }
  );

  DietPlan.associate = (models) => {
    DietPlan.belongsTo(models.User, { foreignKey: 'userId' });
    DietPlan.belongsTo(models.User, {
      foreignKey: 'dietitianId',
      as: 'Dietitian',
    });
    if (models.UserPlan) {
      DietPlan.belongsTo(models.UserPlan, { foreignKey: 'userPlanId' });
    }
    if (models.AIGenerationLog) {
      DietPlan.belongsTo(models.AIGenerationLog, {
        foreignKey: 'aiGenerationLogId',
      });
    }
    if (models.DietPlanDay) {
      DietPlan.hasMany(models.DietPlanDay, {
        foreignKey: 'dietPlanId',
        onDelete: 'CASCADE',
      });
    }
  };

  return DietPlan;
};
