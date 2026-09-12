// Same-day-freeze edge-case proof, scoped to one test account.
// Answers: "freeze for 1 day, then unfreeze SOME HOURS later (before a
// full 24h has actually passed, even if it's technically 'the next day'
// on the calendar) -- is there any leakage? Does the user lose a day, or
// get charged for a day they didn't use?"
//
// The freeze math (diffDays in planFreezeController.js) works off raw
// elapsed MILLISECONDS, not calendar dates -- so "crossing midnight"
// literally cannot matter to it, only real elapsed hours can. This
// script proves that empirically instead of just trusting the reasoning:
// it runs three scenarios back to back against the SAME real controller
// code, restoring the account between each one.
//
//   node scripts/demo_same_day_unfreeze.js <email>

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../models');
const { User, UserPlan, sequelize } = db;
const planFreezeController = require('../controllers/FrontSite/planFreezeController');

const EMAIL = process.argv[2];
const FREEZE_DAYS = 1;

// Each scenario: how many hours "actually pass" before unfreezing, and
// what we expect as a result.
const SCENARIOS = [
  { label: '10 hours later (well within the day)',       hours: 10,   expectRefundDays: 1, expectChargedDays: 0 },
  { label: '23.9 hours later (just under the 24h mark)',  hours: 23.9, expectRefundDays: 1, expectChargedDays: 0 },
  { label: '24.1 hours later (just past the 24h mark)',   hours: 24.1, expectRefundDays: 0, expectChargedDays: 1 },
];

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
  return d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : 'null';
}

async function runScenario(user, planId, scenario) {
  console.log(`\n=== Scenario: ${scenario.label} ===`);

  const before = await UserPlan.findByPk(planId);
  const originalExpiry = before.expireDate;
  const originalTotalFrozenDays = before.totalFrozenDays || 0;
  console.log(`  starting expiry: ${fmt(originalExpiry)}, totalFrozenDays: ${originalTotalFrozenDays}`);

  // Freeze for 1 day via the real controller.
  let { req, res } = makeReqRes(user.id, { days: FREEZE_DAYS });
  await planFreezeController.freezePlan(req, res);
  if (res._payload?.status !== '1') {
    console.log(`  FREEZE FAILED: ${JSON.stringify(res._payload)}`);
    return false;
  }
  let fresh = await UserPlan.findByPk(planId);
  console.log(`  after freeze:    expiry ${fmt(fresh.expireDate)} (frozenAt=${fmt(fresh.frozenAt)})`);

  // Backdate frozenAt by the scenario's hour count -- this is the only
  // synthetic part, standing in for real elapsed time.
  const backdated = new Date(Date.now() - scenario.hours * 60 * 60 * 1000);
  await UserPlan.update({ frozenAt: backdated }, { where: { id: planId } });
  console.log(`  simulated:       ${scenario.hours}h passed (frozenAt backdated to ${fmt(backdated)})`);

  // Unfreeze now via the real controller.
  ({ req, res } = makeReqRes(user.id));
  await planFreezeController.unfreezePlan(req, res);
  if (res._payload?.status !== '1') {
    console.log(`  UNFREEZE FAILED: ${JSON.stringify(res._payload)}`);
    return false;
  }
  fresh = await UserPlan.findByPk(planId);
  const refundedDays = res._payload.data.refundedDays;
  const chargedDays = (fresh.totalFrozenDays || 0) - originalTotalFrozenDays;
  const netExpiryShiftMs = new Date(fresh.expireDate).getTime() - new Date(originalExpiry).getTime();
  const netExpiryShiftDays = Math.round(netExpiryShiftMs / (24 * 60 * 60 * 1000));

  console.log(`  after unfreeze:  expiry ${fmt(fresh.expireDate)}, refundedDays=${refundedDays}, totalFrozenDays=${fresh.totalFrozenDays}`);
  console.log(`  net expiry shift vs starting point: ${netExpiryShiftDays} day(s)`);

  const ok =
    refundedDays === scenario.expectRefundDays &&
    chargedDays === scenario.expectChargedDays &&
    netExpiryShiftDays === scenario.expectChargedDays;

  console.log(ok
    ? `  PASS -- charged exactly ${scenario.expectChargedDays} day(s), refunded exactly ${scenario.expectRefundDays} day(s), no leakage.`
    : `  FAIL -- expected charged=${scenario.expectChargedDays}/refunded=${scenario.expectRefundDays}, got charged=${chargedDays}/refunded=${refundedDays}. Needs investigating.`);

  return ok;
}

async function main() {
  if (!EMAIL) {
    console.log('Usage: node scripts/demo_same_day_unfreeze.js <email>');
    process.exit(1);
  }

  const user = await User.findOne({ where: { email: EMAIL } });
  if (!user) { console.log(`No user found with email ${EMAIL}.`); process.exit(1); }

  const plan = await UserPlan.findOne({ where: { userId: user.id }, order: [['expireDate', 'DESC']] });
  if (!plan) { console.log(`User ${EMAIL} has no UserPlan row.`); process.exit(1); }
  if (plan.frozenAt) { console.log(`Plan is already frozen right now -- unfreeze it for real first.`); process.exit(1); }
  if (!(new Date(plan.expireDate) > new Date())) { console.log(`Plan expireDate is already in the past.`); process.exit(1); }

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
  console.log(`Original expiry: ${fmt(original.expireDate)}`);

  let allOk = true;
  try {
    for (const scenario of SCENARIOS) {
      // Reset to the true original before each scenario so they don't
      // compound on each other.
      await UserPlan.update(original, { where: { id: plan.id } });
      const ok = await runScenario(user, plan.id, scenario);
      allOk = allOk && ok;
    }
  } finally {
    await UserPlan.update(original, { where: { id: plan.id } });
    const restored = await UserPlan.findByPk(plan.id);
    console.log(`\nRestored UserPlan id=${plan.id} to its original state -- expiry back to ${fmt(restored.expireDate)}, frozenAt=${fmt(restored.frozenAt)}, totalFrozenDays=${restored.totalFrozenDays}.`);
    // Let the fire-and-forget notifications from all three scenarios
    // finish before we close the DB pool.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(`\nOverall: ${allOk ? 'ALL SCENARIOS PASS -- no leakage across the 24h boundary.' : 'SOME SCENARIOS FAILED -- see above.'}`);
}

main()
  .catch((err) => { console.error('Script failed:', err); process.exit(1); })
  .finally(async () => {
    try { await sequelize.close(); } catch (_) {}
  });
