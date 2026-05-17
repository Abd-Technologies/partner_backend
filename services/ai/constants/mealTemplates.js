// Meal-count templates. The dietitian sets `user.mealsPerDay` during
// the consultation; the AI service looks up the meal-type sequence here
// so the prompt and the response schema stay in lockstep.
//
// Order matters — these arrays drive both the prompt copy and the
// validator's "no missing types, no duplicates" check.
const MEAL_TEMPLATES = {
  3: ['breakfast', 'lunch', 'dinner'],
  4: ['breakfast', 'lunch', 'afternoon_snack', 'dinner'],
  5: ['breakfast', 'mid_morning', 'lunch', 'afternoon_snack', 'dinner'],
  6: ['breakfast', 'mid_morning', 'lunch', 'afternoon_snack', 'evening_snack', 'dinner'],
};

// Superset of every meal type that may appear in any template. The
// response schema's `mealType` enum lists every value here; the prompt
// (and the validator) restrict which ones are used per `mealsPerDay`.
const VALID_MEAL_TYPES = [
  'breakfast',
  'mid_morning',
  'lunch',
  'afternoon_snack',
  'evening_snack',
  'dinner',
];

module.exports = { MEAL_TEMPLATES, VALID_MEAL_TYPES };
