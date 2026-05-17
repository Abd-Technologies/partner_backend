const {
  MEAL_TEMPLATES,
  VALID_MEAL_TYPES,
} = require('../constants/mealTemplates');

const TIME_PATTERN = /^\d{2}:\d{2}$/;

/**
 * Validate the structure + business rules of a diet plan returned by
 * the AI. Schema enforcement covers the JSON shape; this layer covers
 * the things JSON Schema can't express:
 *   - day count matches planDays
 *   - meals match the per-mealsPerDay template (no missing types,
 *     no extras, no duplicates, but the order is intentionally NOT
 *     enforced — model may legitimately reorder by time of day)
 *   - allergy keywords don't appear in any food name
 *   - daily totalCalories within ±150 of target
 *   - time strings are HH:MM
 *   - mealType values are in the global enum
 *
 * @param {object} plan       The parsed JSON from Gemini.
 * @param {object} user       Same user object used to build the prompt.
 * @param {number} planDays   Expected number of days.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateDietPlan(plan, user, planDays) {
  const errors = [];

  if (!plan || typeof plan !== 'object') {
    return { valid: false, errors: ['plan is missing or not an object'] };
  }

  if (!Array.isArray(plan.days) || plan.days.length !== planDays) {
    errors.push(
      `Expected ${planDays} days, got ${
        Array.isArray(plan.days) ? plan.days.length : 'none'
      }`
    );
  }

  const expectedTypes = MEAL_TEMPLATES[user.mealsPerDay] || [];
  const expectedTypeSet = new Set(expectedTypes);

  const allergyKeywords = (user.allergies || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  for (const day of plan.days || []) {
    const dayLabel = `Day ${day && day.dayNumber}`;

    if (!Array.isArray(day.meals) || day.meals.length !== user.mealsPerDay) {
      errors.push(
        `${dayLabel}: ${
          Array.isArray(day.meals) ? day.meals.length : 0
        } meals (expected ${user.mealsPerDay})`
      );
      continue;
    }

    // Meal-type accounting — missing / extra / duplicate.
    const seenCounts = {};
    for (const m of day.meals) {
      seenCounts[m.mealType] = (seenCounts[m.mealType] || 0) + 1;
    }
    for (const t of expectedTypes) {
      if (!seenCounts[t]) errors.push(`${dayLabel}: missing ${t}`);
    }
    for (const t of Object.keys(seenCounts)) {
      if (!expectedTypeSet.has(t)) {
        errors.push(`${dayLabel}: unexpected meal type "${t}"`);
      }
      if (seenCounts[t] > 1) {
        errors.push(`${dayLabel}: duplicate meal type "${t}"`);
      }
    }

    // Per-meal field checks.
    for (const meal of day.meals) {
      if (!VALID_MEAL_TYPES.includes(meal.mealType)) {
        errors.push(
          `${dayLabel}: mealType "${meal.mealType}" is not in VALID_MEAL_TYPES`
        );
      }
      if (typeof meal.time !== 'string' || !TIME_PATTERN.test(meal.time)) {
        errors.push(
          `${dayLabel}: time "${meal.time}" does not match HH:MM`
        );
      }

      const lowerName = String(meal.foodName || '').toLowerCase();
      for (const allergy of allergyKeywords) {
        if (lowerName.includes(allergy)) {
          errors.push(
            `Allergy violation: "${allergy}" in "${meal.foodName}" (${dayLabel})`
          );
        }
      }
    }

    // Calorie target window.
    const diff = Math.abs(
      (day.totalCalories || 0) - (user.targetCalories || 0)
    );
    if (diff > 150) {
      errors.push(
        `${dayLabel}: ${day.totalCalories} kcal is ${diff} off target (>150)`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateDietPlan };
