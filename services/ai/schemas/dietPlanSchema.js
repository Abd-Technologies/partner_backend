// Field names match what we'll save to DietPlanDay/DietPlanMeal in
// Phase B. Keep them stable across Phase A → B so Phase B's persistence
// layer can map straight into the column names without renaming.

/**
 * Build the JSON schema enforced on the Gemini response. Returned as a
 * function (not a static object) because both `planDays` and
 * `mealsPerDay` are still passed in — they shape the prompt's wording
 * even when the schema itself is loose (see below).
 *
 * Why the schema is loose (no minItems/maxItems, no mealType enum):
 * Vertex AI's responseSchema constraint solver rejects schemas whose
 * state graph is "too large for serving" once you cross a threshold.
 * For us that threshold sits between (3 × 5 = 15) — works — and
 * (14 × 4 = 56) — fails with INVALID_ARGUMENT "too many states for
 * serving". The combo that explodes is:
 *
 *   • days: minItems/maxItems = planDays (strict count)
 *   • meals: minItems/maxItems = mealsPerDay (strict count, per day)
 *   • mealType: enum across 6 values (constrains every meal slot)
 *
 * Together those force Gemini's solver to enumerate planDays × mealsPerDay
 * constrained slots up front. We dropped all three because the prompt
 * already specifies the exact day/meal counts and the meal-type list,
 * AND services/ai/validators/dietPlanValidator.js re-checks them
 * server-side — it rejects responses with the wrong day count, missing
 * meal types, duplicates, or extras with friendlier error messages
 * than a schema mismatch would produce. The schema's job here is just
 * to shape the JSON; semantic correctness is the validator's job.
 *
 * @param {number} planDays      Total number of days in the plan.
 *                                Documented in the prompt; not enforced
 *                                by the schema (validator catches drift).
 * @param {number} mealsPerDay   3 | 4 | 5 | 6 — same.
 * @returns {object}             JSON-Schema-shaped responseSchema for Gemini.
 */
// Parameters are intentionally accepted but unused — they're kept on
// the signature so the call site stays expressive ("schema for THIS
// many days × THIS many meals") and so the future tightening described
// above doesn't change the API shape.
// eslint-disable-next-line no-unused-vars
function buildDietPlanSchema(planDays, mealsPerDay) {
  return {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One-paragraph rationale for the plan.',
      },
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dayNumber: { type: 'integer' },
            totalCalories: { type: 'integer' },
            meals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  // mealType is a free string here; the prompt restricts
                  // the legal values per `mealsPerDay`, and the
                  // validator rejects anything outside VALID_MEAL_TYPES.
                  mealType: { type: 'string' },
                  time: {
                    type: 'string',
                    description: 'wall-clock time HH:MM, timezone-naive',
                  },
                  foodName: { type: 'string' },
                  calories: { type: 'integer' },
                  notes: { type: 'string' },
                },
                required: ['mealType', 'time', 'foodName', 'calories'],
              },
            },
          },
          required: ['dayNumber', 'totalCalories', 'meals'],
        },
      },
    },
    required: ['summary', 'days'],
  };
}

module.exports = { buildDietPlanSchema };
