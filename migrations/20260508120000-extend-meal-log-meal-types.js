'use strict';

// Phase F.2 — User-facing meal logging on top of the new structured
// diet plans. Two changes, both backwards compatible:
//
//   1. Extend MealLogs.mealType ENUM from 3 values to 6 so users on
//      a 4/5/6-meal-per-day plan can log every slot. Old rows
//      (breakfast/lunch/dinner only) remain valid.
//   2. Add MealLogs.dietPlanMealId — nullable FK to DietPlanMeals — so
//      a log row can be traced back to the structured-plan meal it was
//      logged against. Existing rows have NULL; new rows from the V2
//      flow get the FK populated.
//
// Idempotent (matches Phase B/C/D pattern) — re-running is a no-op.

const NEW_ENUM_VALUES = [
  'breakfast',
  'mid_morning',
  'lunch',
  'afternoon_snack',
  'evening_snack',
  'dinner',
];

function findColumnKey(tableDescription, lowerName) {
  return Object.keys(tableDescription).find(
    (k) => k.toLowerCase() === lowerName
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── 1. Extend ENUM (MySQL: just MODIFY COLUMN with the new list) ──
    // Re-running this is harmless — MySQL accepts the same ENUM list
    // without changes. Wrap in try/catch so a flaky describe doesn't
    // block the whole migration.
    const enumSql =
      "ALTER TABLE `MealLogs` MODIFY COLUMN `mealType` ENUM('" +
      NEW_ENUM_VALUES.join("','") +
      "') NOT NULL";
    await queryInterface.sequelize.query(enumSql);

    // ── 2. Add dietPlanMealId column + FK + index (case-insensitive
    // existence guard mirrors the Phase B pattern). ────────────────────
    const table = await queryInterface.describeTable('MealLogs');
    const existingFkKey = findColumnKey(table, 'dietplanmealid');
    if (!existingFkKey) {
      await queryInterface.addColumn('MealLogs', 'dietPlanMealId', {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'DietPlanMeals', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
      // Index for the typical lookup ("which logs reference this plan
      // meal" — used by adherence reports later).
      await queryInterface.addIndex('MealLogs', ['dietPlanMealId'], {
        name: 'meal_logs_diet_plan_meal_id_idx',
      });
    }
  },

  async down(queryInterface, Sequelize) {
    // Safety: only narrow the ENUM if no rows hold one of the new
    // values. Otherwise the ALTER would silently coerce them and we'd
    // lose data. Log + skip in that case.
    const [usedRows] = await queryInterface.sequelize.query(
      "SELECT COUNT(*) AS n FROM `MealLogs` WHERE `mealType` IN ('mid_morning', 'afternoon_snack', 'evening_snack')"
    );
    const inUse = Number((usedRows[0] || {}).n || 0);
    if (inUse > 0) {
      console.warn(
        `[20260508120000-extend-meal-log-meal-types] down(): ${inUse} rows ` +
          'use one of the new ENUM values; skipping ENUM rollback to avoid data loss.'
      );
    } else {
      const oldEnumSql =
        "ALTER TABLE `MealLogs` MODIFY COLUMN `mealType` ENUM('breakfast', 'lunch', 'dinner') NOT NULL";
      await queryInterface.sequelize.query(oldEnumSql);
    }

    // Always reversible — index drop first, then column.
    const table = await queryInterface.describeTable('MealLogs');
    const existingFkKey = findColumnKey(table, 'dietplanmealid');
    if (existingFkKey) {
      try {
        await queryInterface.removeIndex(
          'MealLogs',
          'meal_logs_diet_plan_meal_id_idx'
        );
      } catch (_) {
        // Older MySQL implicitly drops FK indexes on column drop.
      }
      await queryInterface.removeColumn('MealLogs', existingFkKey);
    }
  },
};
