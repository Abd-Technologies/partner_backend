const {
  VALID_MEAL_TYPES,
} = require('../services/ai/constants/mealTemplates');

/**
 * DietPlanMeal — one meal row inside a DietPlanDay. Composite-unique on
 * (dietPlanDayId, mealType) so a day can't have two breakfasts. The
 * mealType ENUM is sourced from
 * services/ai/constants/mealTemplates.js — single source of truth
 * across the AI schema, the validator, and persistence.
 */
module.exports = (sequelize, DataTypes) => {
  const DietPlanMeal = sequelize.define(
    'DietPlanMeal',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      dietPlanDayId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      mealType: {
        type: DataTypes.ENUM(...VALID_MEAL_TYPES),
        allowNull: false,
      },
      // Wall-clock time. Stored as string because it represents "the
      // user's local clock time" regardless of where she is. NEVER
      // convert to UTC. See CLAUDE.md timezone rules. Format: HH:MM.
      time: {
        type: DataTypes.STRING(5),
        allowNull: false,
        validate: {
          isHHMM(value) {
            if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
              throw new Error(`time "${value}" must be HH:MM`);
            }
          },
        },
      },
      foodName: {
        type: DataTypes.STRING(500),
        allowNull: false,
      },
      calories: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: 'DietPlanMeals',
      timestamps: true,
      indexes: [
        { fields: ['dietPlanDayId'] },
        {
          unique: true,
          fields: ['dietPlanDayId', 'mealType'],
          name: 'diet_plan_meals_day_type_unique',
        },
      ],
    }
  );

  DietPlanMeal.associate = (models) => {
    if (models.DietPlanDay) {
      DietPlanMeal.belongsTo(models.DietPlanDay, {
        foreignKey: 'dietPlanDayId',
      });
    }
  };

  return DietPlanMeal;
};
