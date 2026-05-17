// test_vertex_v2.js
// Smoke test for services/ai/aiDietPlanGenerator.js. Kept as-is so
// `node test_vertex_v2.js` from the backend root still produces a
// runnable diet plan — useful when iterating on the prompt or the
// schema without spinning up Express + the request flow.
//
// What it asserts: the refactored generator returns success=true and a
// valid 3-day, 5-meal plan for a sample Pakistani user with PCOS in the
// luteal phase. Validation errors (if any) are printed before the plan.

require('dotenv').config();

const { generateDietPlan } = require('./services/ai/aiDietPlanGenerator');

// Sample user (in production this comes from DB / consultation form).
// `mealsPerDay: 5` is dietitian-configurable per user — see
// services/ai/constants/mealTemplates.js for the per-count schedule.
const sampleUser = {
  firstName: 'Ayesha',
  age: 28,
  weightKg: 65,
  heightCm: 162,
  goal: 'weight loss',
  cyclePhase: 'luteal',
  hasPcos: true,
  allergies: 'peanuts, lactose',
  cuisinePreference: 'Pakistani',
  targetCalories: 1500,
  mealsPerDay: 5,
};

const PLAN_DAYS = 3; // start with 3 days for testing; production = 7

async function run() {
  console.log('Generating structured plan...\n');

  const result = await generateDietPlan(sampleUser, PLAN_DAYS);

  console.log(`Response in ${(result.latencyMs / 1000).toFixed(2)}s\n`);

  if (!result.success) {
    console.log('GENERATION FAILED:');
    console.log('  ' + result.error);
    if (result.validation && result.validation.errors.length) {
      console.log('Validation errors:');
      result.validation.errors.forEach((e) => console.log('  - ' + e));
    }
    process.exit(1);
  }

  console.log('All checks passed.\n');

  if (result.tokensUsed) {
    console.log(
      `Tokens — input: ${result.tokensUsed.tokensInput ?? '?'}, ` +
        `output: ${result.tokensUsed.tokensOutput ?? '?'}\n`
    );
  }

  // ── PRETTY PRINT ────────────────────────────────────────────
  const plan = result.plan;
  console.log('--- SUMMARY ---');
  console.log(plan.summary);

  for (const day of plan.days) {
    console.log(`\n--- Day ${day.dayNumber} (${day.totalCalories} kcal) ---`);
    for (const m of day.meals) {
      console.log(
        `${m.time}  ${m.mealType.padEnd(16)} ${m.foodName}  [${m.calories} kcal]`
      );
      if (m.notes) console.log(`            ↳ ${m.notes}`);
    }
  }

  console.log('\n--- DONE ---');
  process.exit(0);
}

run().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
