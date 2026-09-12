// Proof for the new "can't freeze past your own expiry runway" rule.
// Shaista's exact example: 30 days until expiry -> a 40-day freeze must
// be rejected, and the real max allowed is 29 (not 30) -- freezing must
// leave at least 1 day of runway. This is INDEPENDENT of the existing
// remainingFreezeBudget (lifetime) cap; whichever is tighter wins.
//
//   node scripts/demo_expiry_cap.js <email>

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../models');
const { User, UserPlan, sequelize } = db;
const planFreezeController = require('../controllers/FrontSite/planFreezeController');

const EMAIL = process.argv[2];

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

function fmt(d) { return d ? new Date(d).toISOString().slice(0, 10) : 'null'; }

async function tryFreeze(userId, days) {
  const { req, res } = makeReqRes(userId, { days });
  await planFreezeController.freezePlan(req, res);
  return res._payload;
}

async function main() {
  if (!EMAIL) { console.log('Usage: node scripts/demo_expiry_cap.js <email>'); process.exit(1); }

  const user = await User.findOne({ where: { email: EMAIL } });
  if (!user) { console.log(`No user found with email ${EMAIL}.`); process.exit(1); }

  const plan = await UserPlan.findOne({ where: { userId: user.id }, order: [['expireDate', 'DESC']] });
  if (!plan) { console.log(`User has no UserPlan row.`); process.exit(1); }
  if (plan.frozenAt) { console.log(`Plan is already frozen -- unfreeze first.`); process.exit(1); }

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
  console.log(`Testing UserPlan id=${plan.id} for ${EMAIL}. Original expiry: ${fmt(original.expireDate)}`);

  try {
    // Set up Shaista's exact scenario: 30 days until expiry, and give
    // totalFrozenDays plenty of headroom so the OTHER cap
    // (remainingFreezeBudget) can't be the one doing the rejecting --
    // this test is specifically isolating the new expiry-runway rule.
    //
    // Padded by +2 hours on top of the 30 days: daysUntilExpiry is
    // computed with Math.floor(msRemaining / oneDay) at the moment
    // freezePlan actually runs, which is a little while (DB round
    // trips, three attempts) after we set this expiry here. Without
    // the padding, that gap alone shaves the floored result down to 29
    // before we even get to test the real 30-vs-29 boundary -- not a
    // bug, just floor() being exact about elapsed time, but it means
    // the boundary needs breathing room to test reliably.
    const in30Days = new Date(Date.now() + (30 * 24 + 2) * 60 * 60 * 1000);
    await UserPlan.update(
      { expireDate: in30Days, originalDurationDays: 90, totalFrozenDays: 0 },
      { where: { id: plan.id } }
    );
    console.log(`Set expiry to ${fmt(in30Days)} (30 days + 2h from now, for floor()-safety margin), budget headroom = 90.\n`);

    console.log('--- Attempt: freeze for 40 days (should be REJECTED) ---');
    let result = await tryFreeze(user.id, 40);
    console.log(`  status=${result.status}  message="${result.message}"`);
    const rejected40 = result.status === '0';
    console.log(rejected40 ? '  PASS -- correctly rejected.' : '  FAIL -- this should have been rejected!');

    console.log('\n--- Attempt: freeze for exactly 30 days (should be REJECTED -- must leave 1 day) ---');
    result = await tryFreeze(user.id, 30);
    console.log(`  status=${result.status}  message="${result.message}"`);
    const rejected30 = result.status === '0';
    console.log(rejected30 ? '  PASS -- correctly rejected.' : '  FAIL -- this should have been rejected!');

    console.log('\n--- Attempt: freeze for 29 days (should SUCCEED) ---');
    result = await tryFreeze(user.id, 29);
    console.log(`  status=${result.status}  message="${result.message || ''}"`);
    const accepted29 = result.status === '1';
    console.log(accepted29 ? '  PASS -- correctly accepted.' : '  FAIL -- this should have succeeded!');

    if (accepted29) {
      // Clean up the successful freeze so we can restore cleanly.
      const { req, res } = makeReqRes(user.id);
      await planFreezeController.unfreezePlan(req, res);
    }

    console.log(`\nOverall: ${(rejected40 && rejected30 && accepted29) ? 'ALL PASS' : 'SOMETHING FAILED -- see above.'}`);
  } finally {
    await UserPlan.update(original, { where: { id: plan.id } });
    const restored = await UserPlan.findByPk(plan.id);
    console.log(`\nRestored UserPlan id=${plan.id} -- expiry back to ${fmt(restored.expireDate)}, frozenAt=${fmt(restored.frozenAt)}.`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

main()
  .catch((err) => { console.error('Script failed:', err); process.exit(1); })
  .finally(async () => { try { await sequelize.close(); } catch (_) {} });
