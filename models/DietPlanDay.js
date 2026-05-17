/**
 * DietPlanDay — one row per day in a DietPlan. `dayNumber` is 1-based
 * and unique per plan (composite unique index in the migration).
 * `totalCalories` is the AI-validated daily total (server-side
 * validator enforces ±150 of user.targetCalories at generation time).
 */
module.exports = (sequelize, DataTypes) => {
  const DietPlanDay = sequelize.define(
    'DietPlanDay',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      dietPlanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      dayNumber: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      totalCalories: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: 'DietPlanDays',
      timestamps: true,
      indexes: [
        { fields: ['dietPlanId'] },
        {
          unique: true,
          fields: ['dietPlanId', 'dayNumber'],
          name: 'diet_plan_days_plan_day_unique',
        },
      ],
    }
  );

  DietPlanDay.associate = (models) => {
    if (models.DietPlan) {
      DietPlanDay.belongsTo(models.DietPlan, { foreignKey: 'dietPlanId' });
    }
    if (models.DietPlanMeal) {
      DietPlanDay.hasMany(models.DietPlanMeal, {
        foreignKey: 'dietPlanDayId',
        onDelete: 'CASCADE',
      });
    }
  };

  return DietPlanDay;
};
