// Phase A — Progress Screen rebuild.
//
// Pure function. Given a Goal-shaped object plus an optional `today`,
// returns a pace summary the controller can hand straight to the frontend.
//
// Goal shape (subset used here):
//   { startValueKg, targetValueKg, currentValueKg, startDate, targetDate,
//     expectedPaceKgPerWeek }
//
// Output shape:
//   {
//     paceStatus:     "on_track" | "ahead" | "behind" | "warming_up" | "no_data",
//     paceMessage:    string,                  // pre-formatted for the pill
//     weeksAhead:     number,                  // signed; positive = ahead
//     progressPct:    number,                  // 0..1
//     currentDeltaKg: number,                  // signed (current − start)
//     targetDeltaKg:  number,                  // signed (target − start)
//   }
//
// Edge cases handled (covered by PaceEngine.test.js):
//   * elapsed < 2 weeks         → paceStatus="warming_up", message hidden by UI
//   * currentValueKg unknown    → paceStatus="no_data"
//   * |weeks_ahead_or_behind| < 0.5 → on_track
//   * positive weeks_ahead_or_behind → ahead   (relative to goal direction)
//   * negative weeks_ahead_or_behind → behind  (relative to goal direction)

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ON_TRACK_TOLERANCE_WEEKS = 0.5;
const WARMUP_THRESHOLD_WEEKS = 2;

function asUtcMidnight(d) {
  const date = d instanceof Date ? d : new Date(d);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function weeksBetween(startDate, endDate) {
  const start = asUtcMidnight(startDate);
  const end = asUtcMidnight(endDate);
  return (end - start) / MS_PER_DAY / 7;
}

function pluralWeeks(n) {
  return n === 1 ? '1 wk' : `${n} wks`;
}

/**
 * @param {object} goal
 * @param {Date|string} [today]
 * @returns {object}
 */
function computePace(goal, today = new Date()) {
  // Defensive: if any required field is missing or NaN we return a benign
  // shape so a controller that forgot to null-check won't throw.
  if (!goal || goal.startValueKg == null || goal.targetValueKg == null
      || !goal.startDate || !goal.targetDate) {
    return {
      paceStatus: 'no_data',
      paceMessage: '',
      weeksAhead: 0,
      progressPct: 0,
      currentDeltaKg: 0,
      targetDeltaKg: 0,
    };
  }

  const targetDeltaKg = goal.targetValueKg - goal.startValueKg;

  // No movement intended (maintain goal): pace is always on-track if you're
  // within 1 kg of start, otherwise behind. Handled below; expectedPace=0
  // would otherwise divide by zero.
  const totalWeeks = weeksBetween(goal.startDate, goal.targetDate);
  const expectedPace = goal.expectedPaceKgPerWeek != null
    ? goal.expectedPaceKgPerWeek
    : (totalWeeks > 0 ? targetDeltaKg / totalWeeks : 0);

  const elapsedWeeks = weeksBetween(goal.startDate, today);

  if (goal.currentValueKg == null) {
    return {
      paceStatus: 'no_data',
      paceMessage: '',
      weeksAhead: 0,
      progressPct: 0,
      currentDeltaKg: 0,
      targetDeltaKg,
    };
  }

  const currentDeltaKg = goal.currentValueKg - goal.startValueKg;

  // progressPct uses absolute deltas so a -2.1/-5 weight loss reads as 0.42
  // rather than a sign-confused 0.42 vs negative number.
  const progressPct = targetDeltaKg !== 0
    ? Math.max(0, Math.min(1, Math.abs(currentDeltaKg) / Math.abs(targetDeltaKg)))
    : (Math.abs(currentDeltaKg) <= 1 ? 1 : 0);

  // Warming-up window: too noisy to call ahead/behind in the first fortnight.
  if (elapsedWeeks < WARMUP_THRESHOLD_WEEKS) {
    return {
      paceStatus: 'warming_up',
      paceMessage: '',
      weeksAhead: 0,
      progressPct,
      currentDeltaKg: round1(currentDeltaKg),
      targetDeltaKg: round1(targetDeltaKg),
    };
  }

  // Maintain goal — degenerate case where expectedPace is 0.
  if (expectedPace === 0) {
    const drift = Math.abs(currentDeltaKg);
    if (drift <= 1) {
      return {
        paceStatus: 'on_track',
        paceMessage: 'On track',
        weeksAhead: 0,
        progressPct,
        currentDeltaKg: round1(currentDeltaKg),
        targetDeltaKg: round1(targetDeltaKg),
      };
    }
    return {
      paceStatus: 'behind',
      paceMessage: 'Off target',
      weeksAhead: 0,
      progressPct,
      currentDeltaKg: round1(currentDeltaKg),
      targetDeltaKg: round1(targetDeltaKg),
    };
  }

  const expectedDeltaToday = expectedPace * elapsedWeeks;
  const paceDeltaKg = currentDeltaKg - expectedDeltaToday;

  // Sign-aware: divide by expectedPace so that "ahead" means "you've moved
  // further toward the target than schedule" regardless of loss vs gain.
  const weeksAheadOrBehind = paceDeltaKg / expectedPace;

  if (Math.abs(weeksAheadOrBehind) < ON_TRACK_TOLERANCE_WEEKS) {
    return {
      paceStatus: 'on_track',
      paceMessage: 'On track',
      weeksAhead: 0,
      progressPct,
      currentDeltaKg: round1(currentDeltaKg),
      targetDeltaKg: round1(targetDeltaKg),
    };
  }

  // Round to whole weeks for the pill copy. Brief §6.1 edge case: avoid
  // "3.2 wks ahead" — show "3 wks ahead".
  const weeksAheadInt = Math.round(weeksAheadOrBehind);

  if (weeksAheadOrBehind > 0) {
    return {
      paceStatus: 'ahead',
      paceMessage: `${pluralWeeks(Math.max(1, weeksAheadInt))} ahead of schedule`,
      weeksAhead: weeksAheadInt,
      progressPct,
      currentDeltaKg: round1(currentDeltaKg),
      targetDeltaKg: round1(targetDeltaKg),
    };
  }

  const weeksBehindInt = Math.max(1, Math.abs(weeksAheadInt));
  return {
    paceStatus: 'behind',
    paceMessage: `${pluralWeeks(weeksBehindInt)} behind schedule`,
    weeksAhead: weeksAheadInt, // negative
    progressPct,
    currentDeltaKg: round1(currentDeltaKg),
    targetDeltaKg: round1(targetDeltaKg),
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// Helper exposed for the backfill script: derive expectedPace at goal
// creation. Returns 0 when start === target (maintain) or when the date
// range is degenerate (≤0 weeks).
function deriveExpectedPace(startValueKg, targetValueKg, startDate, targetDate) {
  const weeks = weeksBetween(startDate, targetDate);
  if (weeks <= 0) return 0;
  return (targetValueKg - startValueKg) / weeks;
}

module.exports = {
  computePace,
  deriveExpectedPace,
  // Exposed for tests only.
  _internals: { weeksBetween, ON_TRACK_TOLERANCE_WEEKS, WARMUP_THRESHOLD_WEEKS },
};
