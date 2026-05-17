'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => t.toLowerCase()).includes('dietplandays');
    if (exists) return;

    await queryInterface.createTable('DietPlanDays', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      dietPlanId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'DietPlans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      dayNumber: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      totalCalories: {
        type: Sequelize.INTEGER,
        allowNull: false,
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

    await queryInterface.addIndex('DietPlanDays', ['dietPlanId']);
    // Composite unique — one row per (plan, dayNumber). Phase C inserts
    // in a transaction so duplicate-day races can't slip past.
    await queryInterface.addIndex('DietPlanDays', ['dietPlanId', 'dayNumber'], {
      unique: true,
      name: 'diet_plan_days_plan_day_unique',
    });
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const exists = tables.map((t) => t.toLowerCase()).includes('dietplandays');
    if (exists) {
      await queryInterface.dropTable('DietPlanDays');
    }
  },
};
