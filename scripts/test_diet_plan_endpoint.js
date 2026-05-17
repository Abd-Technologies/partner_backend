// Smoke test for the Phase C persistence layer.
//
// Exercises saveDraftDietPlan + activateDietPlan + getActiveDietPlanForUser
// directly (no HTTP / no Vertex AI call) using a synthetic plan that
// matches the AI generator's output shape. Cleans up after itself so
// repeated runs don't pile rows in the dev DB.
//
// Run: node scripts/test_diet_plan_endpoint.js

require('dotenv').config();
const db = require('../models');
const {
  saveDraftDietPlan,
  activateDietPlan,
  getActiveDietPlanForUser,
  listPlansForUser,
  updateMealInPlan,
  cancelDietPlan,
} = require('../services/dietPlanService');

const { User, UserPlan, DietPlan, DietPlanDay, DietPlanMeal } = db;

// Synthetic plan matching the Phase A schema. mealType values + count
// correspond to MEAL_TEMPLATES[5].
const FAKE_AI_PLAN = {
  summary: 'Synthetic plan used by scripts/test_diet_plan_endpoint.js.',
  days: [
    {
      dayNumber: 1,
      totalCalories: 1490,
      meals: [
        { mealType: 'breakfast', time: '08:00', foodName: 'Test oats', calories: 305, notes: 'note' },
        { mealType: 'mid_morning', time: '11:00', foodName: 'Test fruit', calories: 205, notes: 'note' },
        { mealType: 'lunch', time: '13:30', foodName: 'Test daal', calories: 460, notes: 'note' },
        { mealType: 'afternoon_snack', time: '16:30', foodName: 'Test chana', calories: 150, notes: 'note' },
        { mealType: 'dinner', time: '20:00', foodName: 'Test sabzi', calories: 370, notes: 'note' },
      ],
    },
    {
      dayNumber: 2,
      totalCalories: 1370,
      meals: [
        { mealType: 'breakfast', time: '08:00', foodName: 'Day2 cheela', calories: 250, notes: 'note' },
        { mealType: 'mid_morning', time: '11:00', foodName: 'Day2 berries', calories: 140, notes: 'note' },
        { mealType: 'lunch', time: '13:30', foodName: 'Day2 rajma', calories: 550, notes: 'note' },
        { mealType: 'afternoon_snack', time: '16:30', foodName: 'Day2 almonds', calories: 170, notes: 'note' },
        { mealType: 'dinner', time: '20:00', foodName: 'Day2 fish', calories: 260, notes: 'note' },
      ],
    },
    {
      dayNumber: 3,
      totalCalories: 1405,
      meals: [
        { mealType: 'breakfast', time: '08:00', foodName: 'Day3 paratha', calories: 280, notes: 'note' },
        { mealType: 'mid_morning', time: '11:00', foodName: 'Day3 pear', calories: 100, notes: 'note' },
        { mealType: 'lunch', time: '13:30', foodName: 'Day3 chana daal', calories: 550, notes: 'note' },
        { mealType: 'afternoon_snack', time: '16:30', foodName: 'Day3 makhana', calories: 145, notes: 'note' },
        { mealType: 'dinner', time: '20:00', foodName: 'Day3 kebab', calories: 330, notes: 'note' },
      ],
    },
  ],
};

async function pickFixtures() {
  // Pick any User + any UserPlan from the dev DB. We don't care which;
  // we just need foreign-key targets that satisfy the cascade.
  const user = await User.findOne({ order: [['id', 'ASC']] });
  if (!user) throw new Error('No User in dev DB — seed at least one user before running.');

  let userPlan = await UserPlan.findOne({ where: { UserId: user.id } });
  if (!userPlan) {
    // Fallback: any UserPlan. Smoke test doesn't enforce ownership at
    // this layer (the persistence service trusts its caller).
    userPlan = await UserPlan.findOne({ order: [['id', 'ASC']] });
  }
  if (!userPlan) throw new Error('No UserPlan in dev DB — seed one before running.');

  return { user, userPlan };
}

async function cleanup(planId) {
  // Cascade delete handles days + meals. UserPlan / User are not touched.
  if (!planId) return;
  await DietPlan.destroy({ where: { id: planId } });
}

async function main() {
  const { user, userPlan } = await pickFixtures();
  console.log(`fixtures — userId=${user.id}, userPlanId=${userPlan.id}`);

  // 1. Save draft.
  const saved = await saveDraftDietPlan({
    userId: user.id,
    userPlanId: userPlan.id,
    dietitianId: null,
    aiResult: FAKE_AI_PLAN,
    planDays: 3,
    mealsPerDay: 5,
    aiGenerationLogId: null,
  });

  const dayCount = (saved.DietPlanDays || []).length;
  const mealCount = (saved.DietPlanDays || []).reduce(
    (sum, d) => sum + (d.DietPlanMeals || []).length,
    0
  );
  console.log(`saved — dietPlan.id=${saved.id} status=${saved.status}`);
  console.log(`        days=${dayCount} meals=${mealCount}`);

  if (dayCount !== 3) throw new Error(`Expected 3 days, got ${dayCount}`);
  if (mealCount !== 15) throw new Error(`Expected 15 meals, got ${mealCount}`);

  // 2. listPlansForUser — verify the new draft shows up.
  const planList = await listPlansForUser(user.id);
  const matched = planList.find((p) => p.id === saved.id);
  if (!matched) {
    throw new Error(`listPlansForUser did not include id=${saved.id}`);
  }
  console.log(`listPlansForUser — found ${planList.length} plan(s); test plan present.`);

  // 3. updateMealInPlan — change one meal's calories and confirm the
  // parent day's totalCalories was recomputed.
  const day1 = saved.DietPlanDays.find((d) => d.dayNumber === 1);
  const targetMeal = day1.DietPlanMeals.find((m) => m.mealType === 'lunch');
  if (!targetMeal) throw new Error('Could not find lunch meal on day 1');

  const originalDayTotal = day1.totalCalories;
  const originalMealCal = targetMeal.calories;
  const newCal = originalMealCal + 100;
  const expectedNewDayTotal = originalDayTotal + 100;

  const updateResult = await updateMealInPlan(
    targetMeal.id,
    { foodName: 'Updated lunch by smoke test', calories: newCal },
    null
  );
  if (updateResult.meal.calories !== newCal) {
    throw new Error(
      `Meal calories did not update: expected ${newCal}, got ${updateResult.meal.calories}`
    );
  }
  if (updateResult.meal.foodName !== 'Updated lunch by smoke test') {
    throw new Error('Meal foodName did not update');
  }
  if (updateResult.day.totalCalories !== expectedNewDayTotal) {
    throw new Error(
      `Day totalCalories not recomputed: expected ${expectedNewDayTotal}, got ${updateResult.day.totalCalories}`
    );
  }
  console.log(
    `updateMealInPlan — meal calories ${originalMealCal} → ${newCal}, ` +
      `day total ${originalDayTotal} → ${updateResult.day.totalCalories}.`
  );

  // 4. Activate.
  const activated = await activateDietPlan(saved.id, null);
  console.log(`activated — status=${activated.status} activatedAt=${activated.activatedAt}`);
  if (activated.status !== 'active') {
    throw new Error(`Expected status active, got ${activated.status}`);
  }

  // 5. Read back via the user-facing query.
  const fetched = await getActiveDietPlanForUser(user.id);
  if (!fetched) throw new Error('getActiveDietPlanForUser returned null');
  console.log(`fetched — id=${fetched.id} days=${(fetched.DietPlanDays || []).length}`);
  if (fetched.id !== saved.id) {
    throw new Error(
      `Expected fetched.id=${saved.id}, got ${fetched.id} — multiple active plans?`
    );
  }

  // 6. cancelDietPlan — exercise reason append + status flip.
  const cancelReason = 'Smoke test cancellation reason';
  const cancelled = await cancelDietPlan(saved.id, null, cancelReason);
  if (cancelled.status !== 'cancelled') {
    throw new Error(`Expected status cancelled, got ${cancelled.status}`);
  }
  if (!cancelled.cancelledAt) {
    throw new Error('cancelledAt was not stamped');
  }
  if (!cancelled.summary || !cancelled.summary.includes(cancelReason)) {
    throw new Error(
      `Summary did not include reason. Summary: ${cancelled.summary}`
    );
  }
  console.log(
    `cancelled — status=${cancelled.status} cancelledAt=${cancelled.cancelledAt}, summary contains reason.`
  );

  // 7. Cleanup so repeat runs stay tidy.
  await cleanup(saved.id);
  console.log('cleanup — test plan deleted.');

  await db.sequelize.close();
  console.log('\nSmoke test OK');
}

main().catch(async (err) => {
  console.error('\nFAILED:', err && err.stack ? err.stack : err);
  try {
    await db.sequelize.close();
  } catch (_) {}
  process.exit(1);
});
