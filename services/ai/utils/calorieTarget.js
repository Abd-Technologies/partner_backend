// Shared with dietPlanAdminController.js (dietitian-triggered generation)
// and trialDietPlanController.js (trial quick-intake auto-generation) so
// both paths compute the exact same calorie target the exact same way —
// same reasoning as utils/allergies.js: two copies of this math would
// eventually drift, and a mismatch here reads to the user as an
// inconsistent/broken plan.
//
// Originally generateDietPlanDraft sent a hardcoded targetCalories: 1500
// to every user regardless of body stats, age, activity, or goal. The AI
// prompt tells Gemini to land within ±150 of that number, but Gemini
// ("an expert dietitian") would often generate calorie-appropriate meals
// for the user's actual weight/height/age instead of forcing an
// unrealistic flat 1500 — and dietPlanValidator.js then rejected those
// days as "off target", surfacing as "validation failed" on generate.
// Replaced with a real Mifflin-St Jeor estimate (Fit Her is women-only,
// so the female constant is fixed) scaled by activity level and nudged
// for the client's stated goal. This is a generation heuristic to keep
// Gemini's own math aligned with the number we told it to hit — not
// medical/clinical dosing.
const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

function resolveActivityMultiplier(lifestyle) {
  const raw = (
    lifestyle && lifestyle.activityLevel ? String(lifestyle.activityLevel) : ''
  ).toLowerCase();
  if (raw.includes('very')) return ACTIVITY_MULTIPLIERS.very_active;
  if (raw.includes('active')) return ACTIVITY_MULTIPLIERS.active;
  if (raw.includes('moderate')) return ACTIVITY_MULTIPLIERS.moderate;
  if (raw.includes('sedentary')) return ACTIVITY_MULTIPLIERS.sedentary;
  if (raw.includes('light')) return ACTIVITY_MULTIPLIERS.light;
  return ACTIVITY_MULTIPLIERS.light; // unknown — assume lightly active
}

function computeTargetCalories({ weightKg, heightCm, age, lifestyle, goalKey }) {
  const w = parseFloat(weightKg);
  const h = parseFloat(heightCm);
  const a = parseFloat(age);
  if (
    !Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(a) ||
    w <= 0 || h <= 0 || a <= 0
  ) {
    return 1500; // missing/bad profile data — fall back to the old default
  }

  // Mifflin-St Jeor, female constant (Fit Her is a women's wellness app).
  const bmr = 10 * w + 6.25 * h - 5 * a - 161;
  const tdee = bmr * resolveActivityMultiplier(lifestyle);

  const goal = (goalKey || '').toLowerCase();
  let target = tdee;
  if (goal.includes('weight_loss') || goal.includes('weight loss')) {
    target = tdee - 500;
  } else if (goal.includes('weight_gain') || goal.includes('weight gain')) {
    target = tdee + 400;
  }
  // Conservative safety floor/ceiling regardless of the math above.
  target = Math.max(1200, Math.min(2800, target));
  return Math.round(target / 50) * 50; // round to nearest 50 kcal
}

module.exports = {
  ACTIVITY_MULTIPLIERS,
  resolveActivityMultiplier,
  computeTargetCalories,
};
