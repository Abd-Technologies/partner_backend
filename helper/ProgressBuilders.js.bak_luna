// Phase B — Progress Screen rebuild.
//
// Period-aware sub-builders shared by ProgressController. Each function is
// independently failure-tolerant: a thrown DB error returns `null`/empty
// rather than blowing up the surrounding Promise.all. The ProgressController
// composes these and never has to worry about partial-data responses.
//
// IMPORTANT: this module is for the new /users/progress/* endpoints only.
// DashboardController (the home V2 endpoint) keeps its own builders for now
// because their semantics are window-fixed (today / this-week) and don't
// translate cleanly to a `period` parameter. The two controllers will share
// only the helpers below — buildUserBlock / buildSocialJoined / buildCycle.

const { Op } = require('sequelize');
const {
  User,
  WeeklyCheckin,
  DailyCheckin,
  ClassAttendance,
  UserCycleData,
  WaterLog,
  Goal,
} = require('../models');

const CyclePhase = require('./CyclePhaseCalculator');
const PaceEngine = require('./PaceEngine');
const WeightProjection = require('./WeightProjection');
const SymptomDelta = require('./SymptomDelta');
const NutritionTips = require('./NutritionTips');
const { calculateWaterTargetMl } = require('./WaterTargetCalculator');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ───────── shared utilities ─────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function localDateOnly(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function safeAvg(values, decimals = 1) {
  if (!values || values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  const factor = 10 ** decimals;
  return Math.round(avg * factor) / factor;
}

async function settled(promise, label) {
  try { return await promise; }
  catch (err) {
    console.error(`ProgressBuilders.${label} failed:`, err);
    return null;
  }
}

// ───────── identity / cycle / social ────────────────────────────────────

async function fetchUser(userId) {
  return User.findOne({
    where: { id: userId },
    attributes: ['id', 'firstName', 'image', 'targetWeightKg', 'mainGoal', 'createdAt'],
  });
}

function buildUserBlock(userRow) {
  if (!userRow) return null;
  return {
    firstName: userRow.firstName || '',
    image: userRow.image || null,
  };
}

async function buildCyclePhase(userId, asOfDate) {
  const row = await UserCycleData.findOne({ where: { userId } });
  if (!row || !row.lastPeriodDate || row.dataProvided !== 1) {
    return { phase: null, cycleDay: null, hasData: false };
  }
  const info = CyclePhase.calculate({
    lastPeriodDate: row.lastPeriodDate,
    averageCycleLength: row.averageCycleLength || 28,
    today: asOfDate,
  });
  if (!info) return { phase: null, cycleDay: null, hasData: false };
  return {
    phase: info.phase,
    cycleDay: info.cycleDay,
    averageCycleLength: row.averageCycleLength || 28,
    lastPeriodDate: row.lastPeriodDate,
    hasData: true,
  };
}

// ───────── goal + pace ──────────────────────────────────────────────────

async function fetchActiveGoal(userId) {
  return Goal.findOne({
    where: { userId, status: 'active' },
    order: [['updatedAt', 'DESC']],
  });
}

async function latestWeight(userId, asOfDate) {
  const row = await WeeklyCheckin.findOne({
    where: {
      userId,
      weightKg: { [Op.not]: null },
      weekDate: { [Op.lte]: localDateOnly(asOfDate) },
    },
    order: [['weekDate', 'DESC']],
    attributes: ['weightKg', 'weekDate'],
  });
  return row;
}

async function buildGoalBlock(userId, userRow, asOfDate) {
  const goal = await fetchActiveGoal(userId);
  const latest = await latestWeight(userId, asOfDate);

  // No Goal row yet (e.g. backfill skipped this user) → fall back to the
  // legacy User.targetWeightKg signal so the hero card can still render.
  if (!goal) {
    if (!userRow || userRow.targetWeightKg == null) return null;
    return {
      label: null,
      targetDeltaKg: null,
      targetDate: null,
      currentDeltaKg: null,
      progressPct: 0,
      paceStatus: 'no_data',
      paceMessage: '',
      weeksAhead: 0,
      hasGoalRow: false,
    };
  }

  // Snapshot the most recent weight onto the Goal record so PaceEngine can
  // reason from up-to-date numbers without the controller threading state.
  const currentValueKg = latest ? latest.weightKg : goal.currentValueKg;
  const goalForPace = {
    startValueKg: goal.startValueKg,
    targetValueKg: goal.targetValueKg,
    currentValueKg,
    startDate: goal.startDate,
    targetDate: goal.targetDate,
    expectedPaceKgPerWeek: goal.expectedPaceKgPerWeek,
  };
  const pace = PaceEngine.computePace(goalForPace, asOfDate);

  return {
    label: goal.targetValueKg != null && goal.targetDate
      ? `${goal.targetValueKg}kg by ${goal.targetDate}`
      : null,
    type: goal.type,
    targetValueKg: goal.targetValueKg,
    startValueKg: goal.startValueKg,
    currentValueKg,
    targetDeltaKg: pace.targetDeltaKg,
    currentDeltaKg: pace.currentDeltaKg,
    targetDate: goal.targetDate,
    startDate: goal.startDate,
    progressPct: pace.progressPct,
    paceStatus: pace.paceStatus,
    paceMessage: pace.paceMessage,
    weeksAhead: pace.weeksAhead,
    hasGoalRow: true,
  };
}

// ───────── stats (4 hero tiles) ─────────────────────────────────────────

async function buildStats(userId, period) {
  const [classesAttended, streakDays, sleepRows, energyRows] = await Promise.all([
    settled(countClassesInPeriod(userId, period), 'classesAttended'),
    settled(streakDaysAsOf(userId, period.endMs), 'streakDays'),
    settled(sleepHoursInPeriod(userId, period), 'sleepRows'),
    settled(energyScoresInPeriod(userId, period), 'energyRows'),
  ]);

  return {
    classesAttended: classesAttended ?? 0,
    streakDays: streakDays ?? 0,
    avgSleepHours: safeAvg(sleepRows || [], 1),
    avgEnergyScore: safeAvg(energyRows || [], 1),
  };
}

async function countClassesInPeriod(userId, period) {
  const rows = await ClassAttendance.findAll({
    where: {
      user_id: userId,
      attended_at: { [Op.between]: [period.start, period.end] },
    },
    attributes: ['attended_at'],
    group: ['attended_at'],
  });
  return rows.length;
}

async function streakDaysAsOf(userId, asOfMs) {
  // Same algorithm as DashboardController.buildGoal — ported here so the
  // progress endpoints don't depend on dashboard internals.
  const rows = await ClassAttendance.findAll({
    where: {
      user_id: userId,
      attended_at: { [Op.gte]: new Date(asOfMs - 30 * MS_PER_DAY) },
    },
    attributes: ['attended_at'],
    group: ['attended_at'],
    order: [['attended_at', 'DESC']],
  });
  let streak = 0;
  let cursor = asOfMs;
  for (const r of rows) {
    const d = new Date(r.attended_at);
    const dMid = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (dMid === cursor) {
      streak++;
      cursor -= MS_PER_DAY;
    } else if (dMid < cursor) {
      break;
    }
  }
  return streak;
}

async function sleepHoursInPeriod(userId, period) {
  const rows = await DailyCheckin.findAll({
    where: {
      userId,
      sleepHours: { [Op.not]: null },
      date: { [Op.between]: [period.start, period.end] },
    },
    attributes: ['sleepHours'],
  });
  return rows.map((r) => r.sleepHours).filter((v) => v != null);
}

async function energyScoresInPeriod(userId, period) {
  const rows = await DailyCheckin.findAll({
    where: {
      userId,
      energyLevel: { [Op.not]: null },
      date: { [Op.between]: [period.start, period.end] },
    },
    attributes: ['energyLevel'],
  });
  return rows.map((r) => r.energyLevel).filter((v) => v != null);
}

// ───────── weight series + phase segments + projection ──────────────────

async function buildWeightBlock(userId, period, goalBlock, cycleData) {
  const rows = await WeeklyCheckin.findAll({
    where: {
      userId,
      weightKg: { [Op.not]: null },
      weekDate: { [Op.between]: [period.start, period.end] },
    },
    order: [['weekDate', 'ASC']],
    attributes: ['weekDate', 'weightKg'],
  });

  const history = rows.map((r) => {
    const phase = cycleData && cycleData.hasData
      ? CyclePhase.calculate({
          lastPeriodDate: cycleData.lastPeriodDate,
          averageCycleLength: cycleData.averageCycleLength,
          today: r.weekDate,
        })
      : null;
    return {
      date: r.weekDate,
      weightKg: Number(r.weightKg),
      phase: phase ? phase.phase : null,
    };
  });

  const phaseSegments = buildPhaseSegments(history);

  const currentWeightKg = history.length > 0
    ? history[history.length - 1].weightKg
    : null;

  // Allow projection regardless of period — the dashed line is a forward
  // forecast keyed off the goal's targetDate, not the period window. We
  // still feed only the period's points to keep the regression honest.
  let projection = [];
  if (goalBlock && goalBlock.targetDate) {
    projection = WeightProjection.computeProjection(
      rows.map((r) => ({ date: r.weekDate, weightKg: Number(r.weightKg) })),
      { targetDate: goalBlock.targetDate, today: new Date(period.endMs) },
    );
  }

  const deltaKg = (() => {
    if (history.length < 2) return null;
    const first = history[0].weightKg;
    const last = history[history.length - 1].weightKg;
    return Math.round((last - first) * 10) / 10;
  })();

  let direction = 'no_data';
  if (deltaKg != null && goalBlock && goalBlock.targetValueKg != null && currentWeightKg != null) {
    const targetDelta = goalBlock.targetValueKg - history[0].weightKg;
    direction = (targetDelta < 0 && deltaKg < 0) || (targetDelta > 0 && deltaKg > 0)
      ? 'toward_goal'
      : (deltaKg === 0 ? 'no_change' : 'away_from_goal');
  }

  return {
    currentWeightKg,
    deltaKg,
    direction,
    history,
    phaseSegments,
    projection,
  };
}

function buildPhaseSegments(history) {
  if (history.length === 0) return [];
  const segs = [];
  let cur = null;
  for (const point of history) {
    if (point.phase == null) {
      // Close any open segment and skip the gap.
      if (cur) { segs.push(cur); cur = null; }
      continue;
    }
    if (!cur || cur.phase !== point.phase) {
      if (cur) segs.push(cur);
      cur = { phase: point.phase, start: point.date, end: point.date };
    } else {
      cur.end = point.date;
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

// ───────── glance (4 rings) ─────────────────────────────────────────────

async function buildGlance(userId, period, goalBlock, cycleData) {
  const SLEEP_TARGET_HOURS = 8;
  const [classesAttended, sleepRows, waterRows, latest] = await Promise.all([
    settled(countClassesInPeriod(userId, period), 'glance.classes'),
    settled(sleepHoursInPeriod(userId, period), 'glance.sleep'),
    settled(waterMlInPeriod(userId, period), 'glance.water'),
    settled(latestWeight(userId, new Date(period.endMs)), 'glance.weight'),
  ]);

  const goal = await settled(fetchActiveGoal(userId), 'glance.goal');
  const weeklyClassTarget = goal ? goal.weeklyClassTarget : 4;
  const weeksInPeriod = Math.max(1, Math.round(period.days / 7));
  const classesTarget = weeklyClassTarget * weeksInPeriod;

  const avgSleep = safeAvg(sleepRows || [], 1);
  const avgWaterMl = safeAvg(waterRows || [], 0);

  const phase = cycleData ? cycleData.phase : null;
  const weightKg = latest ? latest.weightKg : null;
  const waterTargetMl = calculateWaterTargetMl(weightKg, phase);

  const goalPct = goalBlock ? goalBlock.progressPct : 0;
  const goalLabel = goalBlock
    ? (goalBlock.paceStatus === 'on_track' ? 'On track'
      : goalBlock.paceStatus === 'ahead' ? 'Ahead'
      : goalBlock.paceStatus === 'behind' ? 'Behind'
      : goalBlock.paceStatus === 'warming_up' ? 'Just started'
      : 'Set goal')
    : 'Set goal';

  const safePct = (n, d) => {
    if (n == null || d == null || d === 0) return 0;
    return Math.max(0, Math.min(1, n / d));
  };

  return {
    rings: [
      {
        key: 'classes',
        label: 'Classes',
        value: classesAttended ?? 0,
        target: classesTarget,
        pct: safePct(classesAttended ?? 0, classesTarget),
      },
      {
        key: 'sleep',
        label: 'Sleep',
        value: avgSleep,
        target: SLEEP_TARGET_HOURS,
        unit: 'h',
        pct: safePct(avgSleep, SLEEP_TARGET_HOURS),
      },
      {
        key: 'water',
        label: 'Water',
        value: avgWaterMl != null ? Math.round((avgWaterMl / 1000) * 10) / 10 : null,
        target: Math.round((waterTargetMl / 1000) * 10) / 10,
        unit: 'L',
        pct: safePct(avgWaterMl, waterTargetMl),
        nudge: avgWaterMl != null && avgWaterMl < waterTargetMl * 0.7 ? 'drink more' : null,
      },
      {
        key: 'goal',
        label: 'Goal',
        value: Math.round(goalPct * 100) / 100,
        target: 1,
        pct: goalPct,
        statusLabel: goalLabel,
      },
    ],
  };
}

async function waterMlInPeriod(userId, period) {
  const rows = await WaterLog.findAll({
    where: {
      userId,
      date: { [Op.between]: [period.start, period.end] },
    },
    attributes: ['date', 'amountMl'],
  });
  // Aggregate per day, then return the per-day totals so the average is
  // "average daily water in this period" not "per-log average".
  const byDay = new Map();
  for (const r of rows) {
    const key = r.date;
    byDay.set(key, (byDay.get(key) || 0) + (r.amountMl || 0));
  }
  return [...byDay.values()];
}

// ───────── hydration card ───────────────────────────────────────────────

async function buildHydration(userId, period, cycleData) {
  const [perDay, latest] = await Promise.all([
    settled(waterMlInPeriod(userId, period), 'hydration.perDay'),
    settled(latestWeight(userId, new Date(period.endMs)), 'hydration.weight'),
  ]);

  const avgMl = safeAvg(perDay || [], 0) || 0;
  const phase = cycleData ? cycleData.phase : null;
  const weightKg = latest ? latest.weightKg : null;
  const targetMl = calculateWaterTargetMl(weightKg, phase);

  const tip = NutritionTips.getPhaseTip(phase);

  return {
    averageL: avgMl != null ? Math.round((avgMl / 1000) * 10) / 10 : 0,
    averageMl: avgMl,
    targetL: Math.round((targetMl / 1000) * 10) / 10,
    targetMl,
    pct: targetMl > 0 ? Math.max(0, Math.min(1, avgMl / targetMl)) : 0,
    nudge: avgMl < targetMl * 0.7 ? 'drink more' : null,
    daysLogged: (perDay || []).length,
    phaseTip: tip,
    mealsCard: { copy: 'Meals · coming soon', enabled: false },
  };
}

// ───────── symptoms ─────────────────────────────────────────────────────

const SYMPTOM_FIELDS = [
  { key: 'bloating', column: 'bloatingSeverity', label: 'Bloating' },
  { key: 'energy', column: 'energyLevel', label: 'Energy' },
  { key: 'mood', column: 'moodLevel', label: 'Mood' },
  { key: 'cramps', column: 'crampSeverity', label: 'Cramps' },
];

async function buildSymptoms(userId, period) {
  // One DailyCheckin scan covers both windows. Cheaper than two queries
  // and the dataset for a year is at most ~365 rows per user.
  const rows = await DailyCheckin.findAll({
    where: {
      userId,
      date: { [Op.between]: [period.previousStart, period.end] },
    },
    attributes: ['date', 'bloatingSeverity', 'energyLevel', 'moodLevel', 'crampSeverity'],
  });

  const buckets = {};
  for (const f of SYMPTOM_FIELDS) buckets[f.key] = { current: [], previous: [] };

  for (const r of rows) {
    const inCurrent = r.date >= period.start && r.date <= period.end;
    const inPrev = r.date >= period.previousStart && r.date <= period.previousEnd;
    for (const f of SYMPTOM_FIELDS) {
      const v = r[f.column];
      if (v == null) continue;
      if (inCurrent) buckets[f.key].current.push(v);
      else if (inPrev) buckets[f.key].previous.push(v);
    }
  }

  const symptoms = SYMPTOM_FIELDS.map((f) => {
    const delta = SymptomDelta.computeSymptomDelta(
      f.key,
      buckets[f.key].current,
      buckets[f.key].previous,
    );
    return { ...delta, label: f.label };
  });

  const basedOnCheckIns = rows.filter((r) => r.date >= period.start && r.date <= period.end).length;
  return { symptoms, basedOnCheckIns };
}

// ───────── insights hub (static-source, ranked) ─────────────────────────

const StaticInsights = require('./StaticInsights');

function buildHubInsights(cycleData, limit = 3) {
  // StaticInsights exports getInsight(phase, cycleDay) → 1 entry. We need
  // top-N. We re-import the underlying dataset shape here by calling
  // getInsight against a few cycleDay anchors, which gives diverse copy
  // without requiring StaticInsights to expose its internals.
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 3));

  const phase = cycleData && cycleData.phase ? cycleData.phase : null;
  const cycleDay = cycleData && cycleData.cycleDay ? cycleData.cycleDay : null;

  // Anchor strategy: current cycleDay first, then ±3 day spread to get
  // adjacent templates. If no phase, ask without phase to get rotating
  // generic content, three different days for variety.
  const anchors = phase && cycleDay
    ? [cycleDay, Math.max(1, cycleDay - 3), Math.min(28, cycleDay + 3), cycleDay + 7]
    : [1, 8, 16, 22];

  const seen = new Set();
  const out = [];
  for (const anchor of anchors) {
    const ins = StaticInsights.getInsight(phase, anchor);
    if (!ins || !ins.text || seen.has(ins.text)) continue;
    seen.add(ins.text);
    out.push({
      id: `static_${out.length + 1}`,
      headline: deriveHeadline(ins.text),
      subtitle: phase ? `${capitalise(phase)} phase · static tip` : 'Daily nudge',
      body: ins.text,
      tone: 'informational',
      accentHex: ins.accentHex,
      category: phase ? 'phase' : 'cycle',
      isStatic: true,
    });
    if (out.length >= safeLimit) break;
  }

  return {
    insights: out,
    patternsFound: out.length,
    isStatic: true,
    honestyBanner: out.length > 0
      ? "FitHer AI is learning. Showing static phase tips for now — personalised patterns arrive after 14 days of check-ins."
      : null,
  };
}

function deriveHeadline(text) {
  // The static templates lead with "Day N - <Title>" or "<Verb-led nudge>".
  // Split on em dash / hyphen first, fall back to first sentence.
  const dashSplit = text.split(/\s[-—]\s/);
  if (dashSplit.length > 1 && dashSplit[0].length <= 40) return dashSplit[0];
  const first = text.split('.')[0];
  return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

function capitalise(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ───────── exports ──────────────────────────────────────────────────────

module.exports = {
  // Data fetchers
  fetchUser,
  fetchActiveGoal,
  latestWeight,
  // Composers
  buildUserBlock,
  buildCyclePhase,
  buildGoalBlock,
  buildStats,
  buildWeightBlock,
  buildGlance,
  buildHydration,
  buildSymptoms,
  buildHubInsights,
  // Utility re-exports
  buildPhaseSegments,
  // Internals exposed for tests
  _internals: {
    safeAvg,
    deriveHeadline,
    SYMPTOM_FIELDS,
  },
};
