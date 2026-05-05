// End-to-end smoke test for the freeze-v2 flow. Exercises:
//
//   1. Schema check — new UserPlan columns exist
//   2. Helper check — findFrozenActivePlan resolves correctly for a
//      not-frozen plan (returns null) and for a frozen plan (returns row)
//   3. Freeze handler — calls the controller's logic directly with a
//      synthetic req/res, verifies the freeze landed
//   4. Gate check — verifies findFrozenActivePlan now returns the plan
//   5. Unfreeze handler — reverses the freeze, verifies clean state
//   6. Auto-unfreeze cron — synthetically backdates a freeze and runs
//      the cron, verifies it flips back
//
// Dry run by default. --commit actually mutates rows (and reverts at
// the end so the DB is left as it was). Use a non-prod DB.
//
//   node partner_backend/scripts/smoke_test_freeze.js
//   node partner_backend/scripts/smoke_test_freeze.js --commit

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Op } = require('sequelize');
const db = require('../models');
const { UserPlan, Appointment, sequelize } = db;
const { findFrozenActivePlan } = require('../helper/freezeGate');
const planFreezeController = require('../controllers/FrontSite/planFreezeController');
const { autoUnfreezeExpiredPlans } = require('../helper/autoUnfreezeExpiredPlans');

const COMMIT = process.argv.includes('--commit');

const REQUIRED_COLUMNS = [
  'frozenAt', 'freezeDays', 'totalFrozenDays',
  'originalDurationDays', 'lastUnfrozenAt', 'frozenBy', 'unfrozenBy',
];

let pass = 0;
let fail = 0;

function check(label, ok, details) {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else    { fail++; console.log(`  ✗ ${label}${details ? ` — ${details}` : ''}`); }
}

// Synthetic Express req/res so we can call controller fns directly.
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

async function step(name, fn) {
  console.log(`\n— ${name} —`);
  try { await fn(); }
  catch (e) { fail++; console.log(`  ✗ EXCEPTION: ${e.message}`); }
}

async function main() {
  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} mode\n`);

  await step('1. Schema check', async () => {
    const [rows] = await sequelize.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'UserPlans'
         AND COLUMN_NAME IN (${REQUIRED_COLUMNS.map(() => '?').join(',')})`,
      { replacements: REQUIRED_COLUMNS }
    );
    const present = new Set(rows.map((r) => r.COLUMN_NAME));
    for (const col of REQUIRED_COLUMNS) {
      check(`UserPlans.${col} exists`, present.has(col),
        present.has(col) ? null : 'run scripts/apply_migration_freeze_v2.sql first');
    }
    if (present.size < REQUIRED_COLUMNS.length) {
      console.log('\nABORT: migration not applied. Stopping.');
      process.exit(1);
    }
  });

  let candidate;
  await step('2. Pick test candidate', async () => {
    candidate = await UserPlan.findOne({
      where: {
        userId: { [Op.not]: null },
        expireDate: { [Op.gt]: new Date() },
        frozenAt: null,
        buyingDate: { [Op.not]: null },
      },
      order: [['expireDate', 'DESC']],
    });
    check('found an active, not-currently-frozen UserPlan', !!candidate,
      candidate ? null : 'no eligible plan to test against — create one or use a different DB');
    if (!candidate) process.exit(1);
    console.log(`    → using UserPlan id=${candidate.id} userId=${candidate.userId}` +
                ` expireDate=${candidate.expireDate?.toISOString().slice(0,10)}` +
                ` totalFrozenDays=${candidate.totalFrozenDays}`);
  });

  await step('3. Helper baseline (not frozen)', async () => {
    const f = await findFrozenActivePlan(candidate.userId);
    check('findFrozenActivePlan returns null when no freeze', f === null);
  });

  if (!COMMIT) {
    console.log('\nDRY RUN complete. Re-run with --commit to exercise the full flow.');
    console.log(`\nResult: ${pass} pass, ${fail} fail`);
    return;
  }

  // Snapshot original state so we can restore at the end even if a
  // step throws.
  const original = {
    expireDate: candidate.expireDate,
    totalFrozenDays: candidate.totalFrozenDays,
    originalDurationDays: candidate.originalDurationDays,
    frozenAt: candidate.frozenAt,
    freezeDays: candidate.freezeDays,
    lastUnfrozenAt: candidate.lastUnfrozenAt,
    frozenBy: candidate.frozenBy,
    unfrozenBy: candidate.unfrozenBy,
  };

  let freezeOk = false;
  try {
    await step('4. Freeze handler', async () => {
      const { req, res } = makeReqRes(candidate.userId, { days: 3 });
      await planFreezeController.freezePlan(req, res);
      check('returns status=1', res._payload?.status === '1',
        `got: ${JSON.stringify(res._payload)}`);
      const plan = await UserPlan.findByPk(candidate.id);
      check('frozenAt set', plan.frozenAt != null);
      check('freezeDays = 3', plan.freezeDays === 3);
      check('originalDurationDays snapshotted', plan.originalDurationDays != null);
      check('frozenBy set to userId', plan.frozenBy === candidate.userId);
      const expectedShift = 3 * 24 * 60 * 60 * 1000;
      const actualShift = new Date(plan.expireDate).getTime() - new Date(original.expireDate).getTime();
      check('expireDate pushed forward by 3 days',
        Math.abs(actualShift - expectedShift) < 60 * 1000,
        `actual shift ms=${actualShift}`);
      freezeOk = true;
    });

    await step('5. Gate fires while frozen', async () => {
      const f = await findFrozenActivePlan(candidate.userId);
      check('findFrozenActivePlan returns the frozen plan', f && f.id === candidate.id);
    });

    await step('6. Unfreeze handler', async () => {
      const { req, res } = makeReqRes(candidate.userId);
      await planFreezeController.unfreezePlan(req, res);
      check('returns status=1', res._payload?.status === '1',
        `got: ${JSON.stringify(res._payload)}`);
      const plan = await UserPlan.findByPk(candidate.id);
      check('frozenAt cleared', plan.frozenAt == null);
      check('freezeDays cleared', plan.freezeDays == null);
      check('lastUnfrozenAt set', plan.lastUnfrozenAt != null);
      check('totalFrozenDays incremented', plan.totalFrozenDays >= original.totalFrozenDays);
      check('unfrozenBy set to userId', plan.unfrozenBy === candidate.userId);
      // Spent 0 full days, so unspent ≈ 3, expireDate should be back near original.
      const drift = Math.abs(new Date(plan.expireDate).getTime() - new Date(original.expireDate).getTime());
      check('expireDate refunded to ~original', drift < 24 * 60 * 60 * 1000,
        `drift ms=${drift}`);
    });

    await step('7. Gate clears after unfreeze', async () => {
      const f = await findFrozenActivePlan(candidate.userId);
      check('findFrozenActivePlan returns null again', f === null);
    });

    await step('8. Auto-unfreeze cron sweep', async () => {
      // Synthetically backdate a freeze by 5 days so the cron's
      // "frozenAt + freezeDays elapsed" check fires immediately.
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      await UserPlan.update(
        { frozenAt: fiveDaysAgo, freezeDays: 1, frozenBy: candidate.userId,
          lastUnfrozenAt: null, unfrozenBy: null },
        { where: { id: candidate.id } }
      );
      const ids = await autoUnfreezeExpiredPlans();
      check('cron unfroze our plan', ids.includes(candidate.id),
        `cron returned: ${JSON.stringify(ids)}`);
      const plan = await UserPlan.findByPk(candidate.id);
      check('frozenAt cleared by cron', plan.frozenAt == null);
      check('unfrozenBy = NULL (cron audit signal)', plan.unfrozenBy == null);
    });
  } finally {
    // Restore exactly what we found, regardless of test outcome.
    await UserPlan.update(original, { where: { id: candidate.id } });
    console.log(`\nRestored UserPlan id=${candidate.id} to original state.`);
  }

  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exitCode = 1;
}

if (require.main === module) {
  main()
    .catch((err) => { console.error('Smoke test failed:', err); process.exit(1); })
    .finally(async () => {
      try { await db.sequelize.close(); } catch (_) {}
    });
}
