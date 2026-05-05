// Phase B — Progress Screen rebuild.
//
// Six endpoints, all under /users/progress/*. Every handler:
//   1. Resolves period via ProgressPeriod.resolvePeriod(query.period, query.asOf)
//   2. Composes data via helpers in ProgressBuilders
//   3. Wraps the response in helper/ApiResponse → { status, message, data }
//   4. Tolerates partial failures: a thrown sub-builder yields null/[] for
//      that block, never a 500 for the whole request.
//
// The controllers do NOT validate `period` strictly (resolvePeriod silently
// falls back to 'month' on unknown values). This matches the spirit of the
// existing repo where most endpoints reject malformed inputs by returning
// the default rather than 4xx-ing the client.

const ApiResponse = require('../../helper/ApiResponse');
const { resolvePeriod, ALLOWED_PERIODS } = require('../../helper/ProgressPeriod');
const PB = require('../../helper/ProgressBuilders');

// Tiny helper so each handler doesn't repeat the same period-out preamble.
function periodEnvelope(period) {
  return {
    period: period.key,
    period_start: period.start,
    period_end: period.end,
    previous_period_start: period.previousStart,
    previous_period_end: period.previousEnd,
  };
}

async function settled(promise, label) {
  try { return await promise; }
  catch (err) {
    console.error(`ProgressController.${label} failed:`, err);
    return null;
  }
}

function authedUserId(req) {
  return req && req.user && req.user.id;
}

// ───────── B3: GET /users/progress/summary ──────────────────────────────

async function getSummary(req, res) {
  const userId = authedUserId(req);
  if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

  const period = resolvePeriod(req.query.period, req.query.asOf);
  const asOfDate = new Date(period.endMs);

  const userRow = await settled(PB.fetchUser(userId), 'summary.user');
  const cycleData = await settled(PB.buildCyclePhase(userId, asOfDate), 'summary.cycle');
  const goalBlock = await settled(PB.buildGoalBlock(userId, userRow, asOfDate), 'summary.goal');
  const stats = await settled(PB.buildStats(userId, period), 'summary.stats');

  const data = {
    ...periodEnvelope(period),
    user: PB.buildUserBlock(userRow),
    cycle: cycleData,
    goal: goalBlock,
    stats: stats || { classesAttended: 0, streakDays: 0, avgSleepHours: null, avgEnergyScore: null },
  };

  return res.json(ApiResponse('1', 'ok', data));
}

// ───────── B4: GET /users/progress/weight ───────────────────────────────

async function getWeight(req, res) {
  const userId = authedUserId(req);
  if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

  const period = resolvePeriod(req.query.period, req.query.asOf);
  const asOfDate = new Date(period.endMs);

  const [userRow, cycleData] = await Promise.all([
    settled(PB.fetchUser(userId), 'weight.user'),
    settled(PB.buildCyclePhase(userId, asOfDate), 'weight.cycle'),
  ]);
  const goalBlock = await settled(PB.buildGoalBlock(userId, userRow, asOfDate), 'weight.goal');
  const weight = await settled(
    PB.buildWeightBlock(userId, period, goalBlock, cycleData),
    'weight.weight',
  );

  const data = {
    ...periodEnvelope(period),
    ...(weight || {
      currentWeightKg: null,
      deltaKg: null,
      direction: 'no_data',
      history: [],
      phaseSegments: [],
      projection: [],
    }),
  };

  return res.json(ApiResponse('1', 'ok', data));
}

// ───────── B5: GET /users/progress/glance ───────────────────────────────

async function getGlance(req, res) {
  const userId = authedUserId(req);
  if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

  const period = resolvePeriod(req.query.period, req.query.asOf);
  const asOfDate = new Date(period.endMs);

  const [userRow, cycleData] = await Promise.all([
    settled(PB.fetchUser(userId), 'glance.user'),
    settled(PB.buildCyclePhase(userId, asOfDate), 'glance.cycle'),
  ]);
  const goalBlock = await settled(PB.buildGoalBlock(userId, userRow, asOfDate), 'glance.goal');
  const glance = await settled(
    PB.buildGlance(userId, period, goalBlock, cycleData),
    'glance.glance',
  );

  const data = {
    ...periodEnvelope(period),
    ...(glance || { rings: [] }),
  };

  return res.json(ApiResponse('1', 'ok', data));
}

// ───────── B6: GET /users/progress/hydration ────────────────────────────

async function getHydration(req, res) {
  const userId = authedUserId(req);
  if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

  const period = resolvePeriod(req.query.period, req.query.asOf);
  const asOfDate = new Date(period.endMs);

  const cycleData = await settled(PB.buildCyclePhase(userId, asOfDate), 'hydration.cycle');
  const hydration = await settled(
    PB.buildHydration(userId, period, cycleData),
    'hydration.hydration',
  );

  const data = {
    ...periodEnvelope(period),
    ...(hydration || {
      averageL: 0, averageMl: 0, targetL: 0, targetMl: 0, pct: 0,
      nudge: null, daysLogged: 0, phaseTip: null,
      mealsCard: { copy: 'Meals · coming soon', enabled: false },
    }),
  };

  return res.json(ApiResponse('1', 'ok', data));
}

// ───────── B7: GET /users/progress/symptoms ─────────────────────────────

async function getSymptoms(req, res) {
  const userId = authedUserId(req);
  if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

  const period = resolvePeriod(req.query.period, req.query.asOf);
  const symptoms = await settled(PB.buildSymptoms(userId, period), 'symptoms.symptoms');

  const data = {
    ...periodEnvelope(period),
    ...(symptoms || { symptoms: [], basedOnCheckIns: 0 }),
  };

  return res.json(ApiResponse('1', 'ok', data));
}

// ───────── B8: GET /users/progress/insights/hub ─────────────────────────

async function getInsightsHub(req, res) {
  const userId = authedUserId(req);
  if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

  const period = resolvePeriod(req.query.period, req.query.asOf);
  const asOfDate = new Date(period.endMs);
  const limit = Number(req.query.limit) || 3;

  const cycleData = await settled(PB.buildCyclePhase(userId, asOfDate), 'insights.cycle');
  const hub = PB.buildHubInsights(cycleData, limit);

  const data = {
    ...periodEnvelope(period),
    ...hub,
  };

  return res.json(ApiResponse('1', 'ok', data));
}

module.exports = {
  getSummary,
  getWeight,
  getGlance,
  getHydration,
  getSymptoms,
  getInsightsHub,
  // Re-exported so app.js / tests can confirm the allow-list at boot.
  ALLOWED_PERIODS,
};
