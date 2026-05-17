'use strict';

const { VALID_MEAL_TYPES } = require('../services/ai/constants/mealTemplates');

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => t.toLowerCase()).includes('dietplanmeals');
    if (exists) return;

    await queryInterface.createTable('DietPlanMeals', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      dietPlanDayId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'DietPlanDays', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      // ENUM kept in lockstep with services/ai/constants/mealTemplates.js
      // — single source of truth for valid meal types across the AI
      // schema, the validator, and persistence.
      mealType: {
        type: Sequelize.ENUM(...VALID_MEAL_TYPES),
        allowNull: false,
      },
      // Wall-clock time, intentionally timezone-naive. See CLAUDE.md
      // timezone rules. Format: HH:MM.
      time: {
        type: Sequelize.STRING(5),
        allowNull: false,
      },
      foodName: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      calories: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('DietPlanMeals', ['dietPlanDayId']);
    // One meal of each type per day. The AI validator already rejects
    // duplicates client-side; the unique index is the DB-level guard
    // for any future direct INSERTs (admin tooling, manual edits).
    await queryInterface.addIndex(
      'DietPlanMeals',
      ['dietPlanDayId', 'mealType'],
      {
        unique: true,
        name: 'diet_plan_meals_day_type_unique',
      }
    );
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => t.toLowerCase()).includes('dietplanmeals');
    if (exists) {
      await queryInterface.dropTable('DietPlanMeals');
    }
  },
};
