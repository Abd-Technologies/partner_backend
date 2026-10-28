// One answer to "is this plan diet, workout or combined?" (Oct 2026).
//
// Order:
//   1. Plan.planType, when it's set (the backfill below sets it for every
//      plan, and the Plan model keeps it in sync with the category)
//   2. Plan.CategoryId: 1 Diet, 2 Workout, 3 Both — the same ids the class
//      rules already use (helper/classAudience.js)
//   3. The title, as a last resort. A title that mentions both diet and
//      workout counts as combined ("Workout and Dietplan From (Asma)").
const PLAN_TYPES = ["diet", "workout", "combined"];
const CATEGORY_TYPE = { 1: "diet", 2: "workout", 3: "combined" };

function typeFromWords(text) {
  const t = String(text || "").toLowerCase();
  const diet = t.includes("diet");
  const workout = /work\s?-?out/.test(t);
  if (/\bboth\b/.test(t) || t.includes("combined") || (diet && workout)) return "combined";
  if (diet) return "diet";
  if (workout) return "workout";
  return null;
}

function planTypeOf(plan) {
  if (!plan) return null;
  if (PLAN_TYPES.includes(plan.planType)) return plan.planType;
  const byCategory = CATEGORY_TYPE[Number(plan.CategoryId)];
  if (byCategory) return byCategory;
  return typeFromWords(plan.title);
}

const hasDiet = (plan) => ["diet", "combined"].includes(planTypeOf(plan));
const hasWorkout = (plan) => ["workout", "combined"].includes(planTypeOf(plan));

module.exports = { PLAN_TYPES, CATEGORY_TYPE, typeFromWords, planTypeOf, hasDiet, hasWorkout };
