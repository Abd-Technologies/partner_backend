// Phase A — Progress Screen rebuild.
//
// One-shot backfill. For every user with `User.targetWeightKg != null` and
// no existing active Goal row, derives a sensible Goal record from
// WeeklyCheckin history.
//
// Usage:
//   node partner_backend/scripts/backfill_goals.js              # dry run
//   node partner_backend/scripts/backfill_goals.js --commit     # writes
//   node partner_backend/scripts/backfill_goals.js --commit --user 42
//
// Idempotent: running twice without --force is a no-op for users that
// already have an active Goal. --force creates a new Goal even if one
// exists (NOT recommended for prod — used only during dev to iterate).
//
// SAFETY: this script must be run AFTER the goals migration. The prompt
// forbids running it in production from this session — staging only.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Op } = require('sequelize');
const db = require('../models');
const { User, WeeklyCheckin, Goal } = db;
const { deriveExpectedPace } = require('../helper/PaceEngine');

const DEFAULT_HORIZON_WEEKS = 12;

function parseArgs(argv) {
  const args = { commit: false, force: false, userId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit') args.commit = true;
    else if (a === '--force') args.force = true;
    else if (a === '--user') args.userId = Number(argv[++i]);
  }
  return args;
}

function addWeeks(date, weeks) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + Math.round(weeks * 7));
  return d;
}

function toIsoDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function classifyGoalType(startKg, targetKg) {
  if (Math.abs(startKg - targetKg) < 0.5) return 'maintain';
  return targetKg < startKg ? 'weight_loss' : 'weight_gain';
}

async function backfillUser(user, opts) {
  const targetWeightKg = user.targetWeightKg;
  if (targetWeightKg == null) {
    return { userId: user.id, skipped: 'no_target_weight' };
  }

  if (!opts.force) {
    const existing = await Goal.findOne({
      where: { userId: user.id, status: 'active' },
    });
    if (existing) return { userId: user.id, skipped: 'goal_exists' };
  }

  // startValue + startDate: prefer earliest WeeklyCheckin row. Fallback to
  // User.weight (legacy STRING column) parsed as a number, dated to
  // User.createdAt. Final fallback: targetWeightKg + 5 (so we don't crash
  // if literally no signal exists).
  let startValueKg = null;
  let startDate = null;
  let currentValueKg = null;
  let currentWeekDate = null;

  const oldest = await WeeklyCheckin.findOne({
    where: { userId: user.id, weightKg: { [Op.not]: null } },
    order: [['weekDate', 'ASC']],
    attributes: ['weightKg', 'weekDate'],
  });
  const newest = await WeeklyCheckin.findOne({
    where: { userId: user.id, weightKg: { [Op.not]: null } },
    order: [['weekDate', 'DESC']],
    attributes: ['weightKg', 'weekDate'],
  });
  if (oldest) {
    startValueKg = oldest.weightKg;
    startDate = oldest.weekDate;
  }
  if (newest) {
    currentValueKg = newest.weightKg;
    currentWeekDate = newest.weekDate;
  }

  if (startValueKg == null) {
    const parsed = Number(user.weight);
    if (Number.isFinite(parsed)) startValueKg = parsed;
    else startValueKg = targetWeightKg + 5; // last-resort placeholder
    startDate = user.createdAt
      ? toIsoDate(user.createdAt)
      : toIsoDate(new Date());
  }

  if (currentValueKg == null) currentValueKg = startValueKg;

  // 12-week horizon from the start date. We deliberately don't read user
  // intent here — this is a backfill, not a goal-setting flow. Real future
  // goals get their targetDate from the goal-setting screen (Phase D).
  const targetDate = toIsoDate(addWeeks(startDate, DEFAULT_HORIZON_WEEKS));
  const expectedPaceKgPerWeek = deriveExpectedPace(
    startValueKg,
    targetWeightKg,
    startDate,
    targetDate,
  );
  const type = classifyGoalType(startValueKg, targetWeightKg);

  const payload = {
    userId: user.id,
    type,
    startValueKg: Number(startValueKg),
    targetValueKg: Number(targetWeightKg),
    currentValueKg: Number(currentValueKg),
    startDate,
    targetDate,
    weeklyClassTarget: 4,
    expectedPaceKgPerWeek,
    status: 'active',
  };

  if (!opts.commit) {
    return { userId: user.id, planned: payload };
  }

  const goal = await Goal.create(payload);
  return { userId: user.id, created: goal.id, payload };
}

async function main() {
  const args = parseArgs(process.argv);
  const where = { targetWeightKg: { [Op.not]: null } };
  if (args.userId) where.id = args.userId;

  const users = await User.findAll({
    where,
    attributes: ['id', 'firstName', 'targetWeightKg', 'weight', 'createdAt'],
  });

  if (users.length === 0) {
    console.log('No users matched. Nothing to backfill.');
    return;
  }

  console.log(`${args.commit ? 'COMMIT' : 'DRY RUN'}: ${users.length} candidate user(s)`);
  if (!args.commit) {
    console.log('Re-run with --commit to actually write Goal rows.');
  }

  let created = 0;
  let skipped = 0;
  for (const user of users) {
    const result = await backfillUser(user, args);
    if (result.created != null) {
      created++;
      console.log(`  user ${user.id} → goal ${result.created} (${result.payload.type})`);
    } else if (result.planned) {
      console.log(`  user ${user.id} → would create (${result.planned.type}, target ${result.planned.targetValueKg})`);
    } else {
      skipped++;
      console.log(`  user ${user.id} → skipped (${result.skipped})`);
    }
  }

  console.log(`\nDone. created=${created} skipped=${skipped} total=${users.length}`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Backfill failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      try { await db.sequelize.close(); } catch (_) {}
    });
}

module.exports = { backfillUser, parseArgs };
