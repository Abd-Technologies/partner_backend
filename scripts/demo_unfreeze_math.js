// Demo/proof script for the freeze -> (days pass) -> early-unfreeze math,
// scoped to ONE specific test account (by email) instead of picking a
// random plan like scripts/smoke_test_freeze.js does. Answers Shaista's
// question directly: "freeze for 10 days, some days pass, then unfreeze
// early -- does the expiry only pick up the days actually spent frozen?"
//
// Runs the REAL controller functions (freezePlan / unfreezePlan), same
// code path a real app tap hits -- not a re-implementation of the math.
// The only synthetic part is backdating `frozenAt` afterward, because we
// can't actually wait days in real time; that's the same technique
// scripts/smoke_test_freeze.js already uses for its cron test.
//
// Always reverts the row to its exact original state in a `finally`, so
// this account's real plan is untouched once the script exits -- same
// safety pattern as smoke_test_freeze.js.
//
// NOTE: freezePlan/unfreezePlan fire real push notifications
// (fire-and-forget) if this account has a deviceToken. If ab@gmail.com is
// logged into a real phone, expect two pushes: "Plan Paused" then
// "Plan Resumed" -- that's a free bonus check that the notification
// wiring from earlier also works, not a bug in this script.
//
//   node scripts/demo_unfreeze_math.js <email> [freezeDays] [daysToSimulatePassing]
//   node scripts/demo_unfreeze_math.js ab@gmail.com 10 4

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../models');
const { User, UserPlan, sequelize } = db;
const planFreezeController = require('../controllers/FrontSite/planFreezeController');

const EMAIL = process.argv[2];
const FREEZE_DAYS = Number(process.argv[3]) || 10;
const SIMULATED_DAYS_PASSED = Number(process.argv[4]) || 4;

function makeReqRes(userId, body = {}) {
  return {
    req: { user: { id: userId }, body, params: {} },
    res: (() => {
      const r = { _payload: null, _status: 200 };
      r.json = (p) => { r._payload = p; return r; };
      r.status = (s) => { r._status = s; return r; };
      return r;
    })(),
  };
}

function fmt(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : 'null';
}

async function main() {
  if (!EMAIL) {
    console.log('Usage: node scripts/demo_unfreeze_math.js <email> [freezeDays] [daysToSimulatePassing]');
    process.exit(1);
  }

  const user = await User.findOne({ where: { email: EMAIL } });
  if (!user) {
    console.log(`No user found with email ${EMAIL}. Nothing touched.`);
    process.exit(1);
  }

  const plan = await UserPlan.findOne({
    where: { userId: user.id },
    order: [['expireDate', 'DESC']],
  });
  if (!plan) {
    console.log(`User ${EMAIL} (id=${user.id}) has no UserPlan row. Nothing touched.`);
    process.exit(1);
  }
  if (plan.frozenAt) {
    console.log(`Plan id=${plan.id} is already frozen right now -- unfreeze it for real first, then re-run this script.`);
    process.exit(1);
  }
  if (!(new Date(plan.expireDate) > new Date())) {
    console.log(`Plan id=${plan.id} expireDate (${fmt(plan.expireDate)}) is already in the past -- pick an account with an active plan.`);
    process.exit(1);
  }
  if (SIMULATED_DAYS_PASSED >= FREEZE_DAYS) {
    console.log(`daysToSimulatePassing (${SIMULATED_DAYS_PASSED}) must be less than freezeDays (${FREEZE_DAYS}) to demonstrate an EARLY unfreeze with a partial refund.`);
    process.exit(1);
  }

  // Snapshot so we can restore no matter what happens below.
  const original = {
    expireDate: plan.expireDate,
    frozenAt: plan.frozenAt,
    freezeDays: plan.freezeDays,
    totalFrozenDays: plan.totalFrozenDays,
    originalDurationDays: plan.originalDurationDays,
    lastUnfrozenAt: plan.lastUnfrozenAt,
    frozenBy: plan.frozenBy,
    unfrozenBy: plan.unfrozenBy,
  };

  console.log(`Testing UserPlan id=${plan.id} for ${EMAIL} (userId=${user.id})`);
  console.log(`Original expiry: ${fmt(plan.expireDate)}\n`);

  try {
    console.log(`--- Step 1: freeze for ${FREEZE_DAYS} days (real freezePlan controller) ---`);
    let { req, res } = makeReqRes(user.id, { days: FREEZE_DAYS });
    await planFreezeController.freezePlan(req, res);
    if (res._payload?.status !== '1') {
      console.log(`Freeze failed: ${JSON.stringify(res._payload)}`);
      return;
    }
    let fresh = await UserPlan.findByPk(plan.id);
    console.log(`  frozenAt        = ${fmt(fresh.frozenAt)}`);
    console.log(`  freezeDays      = ${fresh.freezeDays}`);
    console.log(`  expiry is now   = ${fmt(fresh.expireDate)}  (pushed forward by the full ${FREEZE_DAYS} days)`);

    console.log(`\n--- Step 2: simulate ${SIMULATED_DAYS_PASSED} of those ${FREEZE_DAYS} days actually passing ---`);
    const backdated = new Date(Date.now() - SIMULATED_DAYS_PASSED * 24 * 60 * 60 * 1000);
    await UserPlan.update({ frozenAt: backdated }, { where: { id: plan.id } });
    console.log(`  frozenAt backdated to ${fmt(backdated)} (can't actually wait ${SIMULATED_DAYS_PASSED} real days, so we move the clock back the same way the auto-unfreeze cron test does)`);

    console.log(`\n--- Step 3: unfreeze NOW, ${SIMULATED_DAYS_PASSED} days early (real unfreezePlan controller) ---`);
    ({ req, res } = makeReqRes(user.id));
    await planFreezeController.unfreezePlan(req, res);
    if (res._payload?.status !== '1') {
      console.log(`Unfreeze failed: ${JSON.stringify(res._payload)}`);
      return;
    }
    fresh = await UserPlan.findByPk(plan.id);
    console.log(`  frozenAt        = ${fmt(fresh.frozenAt)} (cleared)`);
    console.log(`  refundedDays    = ${res._payload.data.refundedDays}  (expected: ${FREEZE_DAYS - SIMULATED_DAYS_PASSED})`);
    console.log(`  totalFrozenDays = ${fresh.totalFrozenDays}  (expected added: ${SIMULATED_DAYS_PASSED})`);
    console.log(`  final expiry    = ${fmt(fresh.expireDate)}`);

    const expectedExpiry = new Date(original.expireDate);
    expectedExpiry.setUTCDate(expectedExpiry.getUTCDate() + SIMULATED_DAYS_PASSED);

    console.log(`\n--- Result ---`);
    console.log(`  original expiry (before any freeze) : ${fmt(original.expireDate)}`);
    console.log(`  expected expiry (+${SIMULATED_DAYS_PASSED} actually-frozen days) : ${fmt(expectedExpiry)}`);
    console.log(`  actual expiry after early unfreeze   : ${fmt(fresh.expireDate)}`);
    const match = fmt(fresh.expireDate) === fmt(expectedExpiry);
    console.log(match
      ? `  MATCH -- only the ${SIMULATED_DAYS_PASSED} day(s) actually spent frozen were added, the other ${FREEZE_DAYS - SIMULATED_DAYS_PASSED} were refunded.`
      : `  MISMATCH -- something's off, needs investigating.`);
  } finally {
    await UserPlan.update(original, { where: { id: plan.id } });
    const restored = await UserPlan.findByPk(plan.id);
    console.log(`\nRestored UserPlan id=${plan.id} to its original state -- expiry back to ${fmt(restored.expireDate)}, frozenAt=${fmt(restored.frozenAt)}.`);

    // freezePlan/unfreezePlan fire their push notifications fire-and-forget
    // (by design -- a slow/failing notification must never hold up or
    // fail the freeze/unfreeze itself). That includes an async write to
    // UserNotification for the in-app inbox. Give both notifications a
    // moment to finish before we close the DB connection below, or that
    // trailing write gets cut off mid-flight and logs a harmless but
    // scary-looking "connection manager was closed" error.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

main()
  .catch((err) => { console.error('Script failed:', err); process.exit(1); })
  .finally(async () => {
    try { await sequelize.close(); } catch (_) {}
  });
