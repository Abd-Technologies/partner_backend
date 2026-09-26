const { MEAL_TEMPLATES } = require('../constants/mealTemplates');
const { parseAllergyKeywords } = require('../utils/allergies');

/**
 * Build the prompt sent to Gemini for diet-plan generation.
 *
 * Expected `user` shape:
 *   {
 *     firstName:          string,
 *     age:                number,
 *     weightKg:           number,
 *     heightCm:           number,
 *     goal:               string,           // e.g. "weight loss"
 *     cyclePhase:         string,           // luteal | menstrual | follicular | ovulatory
 *     hasPcos:            boolean,
 *     allergies:          string,           // comma-separated keywords
 *     cuisinePreference:  string,           // e.g. "Pakistani"
 *     targetCalories:     number,           // daily kcal target
 *     mealsPerDay:        3 | 4 | 5 | 6,    // dietitian-set during consultation
 *   }
 *
 * @param {object} user      The user profile (see shape above).
 * @param {number} planDays  How many days the plan should cover.
 * @returns {string}         The prompt string for Gemini.
 * @throws  {Error}          If user.mealsPerDay is not 3/4/5/6.
 */
function buildDietPlanPrompt(user, planDays) {
  const mealTypes = MEAL_TEMPLATES[user.mealsPerDay];
  if (!mealTypes) {
    throw new Error(
      `Invalid mealsPerDay: ${user.mealsPerDay}. Must be one of 3, 4, 5, 6.`
    );
  }

  const mealTypesList = mealTypes.join(', ');
  const mealTypesPipe = mealTypes.join(' | ');

  // Same filter dietPlanValidator.js checks the response against (see
  // utils/allergies.js) — applied here too so Gemini is never told to
  // treat a stray fragment like "g" as a literal ingredient to avoid.
  // That exact bug previously made it into a plan's own summary text
  // ("...while strictly avoiding any foods containing the letter 'g'
  // to ensure safety and well-being"), which is both meaningless and
  // alarming for a dietitian to read.
  const allergyKeywords = parseAllergyKeywords(user.allergies);
  const allergyList = allergyKeywords.length
    ? allergyKeywords.join(', ')
    : 'None reported';
  const allergyRequirement = allergyKeywords.length
    ? `NEVER include foods containing any of: ${allergyList}.`
    : 'No known allergies reported for this client — no exclusions needed on that front.';

  return `You are an expert women's wellness dietitian assistant for Fit Her, a Pakistan-based wellness app. Generate a personalized ${planDays}-day diet plan for this user.

USER DATA:
- Name: ${user.firstName}
- Age: ${user.age}
- Weight: ${user.weightKg} kg
- Height: ${user.heightCm} cm
- Goal: ${user.goal}
- Current cycle phase: ${user.cyclePhase}
- PCOS: ${user.hasPcos ? 'Yes' : 'No'}
- Allergies: ${allergyList}
- Cuisine preference: ${user.cuisinePreference}
- Daily calorie target: ${user.targetCalories} kcal
- Meals per day: ${user.mealsPerDay}

REQUIREMENTS:
1. Exactly ${planDays} days, ${user.mealsPerDay} meals per day, in this order: ${mealTypesList}.
2. Each day's totalCalories within ±150 of ${user.targetCalories}.
3. Use authentic Pakistani / South Asian foods (daal, roti, sabzi, chicken curry, oats with banana, paratha).
4. ${allergyRequirement}
5. Variety: avoid repeating the exact same meal on different days.
6. Cycle-phase awareness:
   - luteal: more iron + magnesium (leafy greens, dark chocolate, lentils)
   - menstrual: warming, easy-to-digest (soups, khichdi, ginger tea)
   - follicular: energy-dense, protein-rich (eggs, paneer, chicken)
   - ovulatory: light, fiber-rich (salads, fruits, sprouts)
7. notes: one short tip per meal explaining the choice.
8. mealType MUST be lowercase snake_case: ${mealTypesPipe}. Use ONLY these — do not introduce other types.
9. time MUST be 24h "HH:MM" wall-clock time (e.g. "08:00", "13:30"). It is intentionally timezone-naive — see CLAUDE.md timezone rules.`;
}

module.exports = { buildDietPlanPrompt };
