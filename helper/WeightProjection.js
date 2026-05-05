// Phase A — Progress Screen rebuild.
//
// Pure function. Linear regression over the last 30 days of WeeklyCheckin
// rows, projected forward to the goal's targetDate. Used to render the
// dashed forward line on the weight trend chart.
//
// v1 brief said "use last 30 days, fewer than 14 points → empty". v2 brief
// relaxes that to "<3 weekly points → empty" because we sample weight
// weekly, not daily. Slope clamp ±0.5 kg/week stays — keeps the line sane
// when a noisy 30-day window would otherwise produce an absurd extrapolation.
//
// Input shape:
//   logs: [{ date: 'YYYY-MM-DD' | Date, weightKg: number }]
//   options: { startDate, targetDate, slopeClampKgPerWeek?, minPoints? }
//
// Output shape:
//   [{ date: 'YYYY-MM-DD', weightKg: number, isProjection: true }]
//   — empty array when input is too thin
//
// Both endpoints (start & target) are *exclusive of today* — the UI draws
// the projection beginning the day AFTER the latest actual log, so historical
// points and projection points never share an x-coordinate.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_POINTS = 3;
const DEFAULT_SLOPE_CLAMP_KG_PER_WEEK = 0.5;

function asUtcMidnight(d) {
  const date = d instanceof Date ? d : new Date(d);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function toIsoDate(utcMs) {
  const d = new Date(utcMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * @param {Array<{date: string|Date, weightKg: number}>} logs
 * @param {object} options
 * @param {string|Date} options.targetDate    Goal target date (end of projection)
 * @param {Date|string} [options.today]       Used in tests; defaults to now
 * @param {number}     [options.minPoints]    ≥3 by default
 * @param {number}     [options.slopeClampKgPerWeek]  ±0.5 by default
 * @returns {Array<{date: string, weightKg: number, isProjection: true}>}
 */
function computeProjection(logs, options = {}) {
  const {
    targetDate,
    today = new Date(),
    minPoints = DEFAULT_MIN_POINTS,
    slopeClampKgPerWeek = DEFAULT_SLOPE_CLAMP_KG_PER_WEEK,
  } = options;

  if (!Array.isArray(logs) || logs.length === 0 || !targetDate) return [];

  // Filter and normalise — drop nulls, coerce to {ms, weightKg}, dedupe by
  // date (latest entry wins).
  const byDay = new Map();
  for (const log of logs) {
    if (!log || log.weightKg == null || !log.date) continue;
    const ms = asUtcMidnight(log.date);
    const w = Number(log.weightKg);
    if (!Number.isFinite(w)) continue;
    byDay.set(ms, w);
  }

  if (byDay.size < minPoints) return [];

  // Sort points oldest → newest.
  const points = [...byDay.entries()]
    .map(([ms, weightKg]) => ({ ms, weightKg }))
    .sort((a, b) => a.ms - b.ms);

  // Restrict the regression window to the last 30 days. We treat 30 days
  // from the most recent log as the window so a user with one weigh-in last
  // year and 5 this month gets a sensible regression.
  const newest = points[points.length - 1];
  const windowStart = newest.ms - 30 * MS_PER_DAY;
  const windowed = points.filter((p) => p.ms >= windowStart);
  if (windowed.length < minPoints) return [];

  // Simple linear regression: y = a + b·x where x = days since first window
  // point. We compute slope in kg/day, then clamp in kg/week.
  const n = windowed.length;
  const x0 = windowed[0].ms;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of windowed) {
    const x = (p.ms - x0) / MS_PER_DAY;
    const y = p.weightKg;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;

  // All points fall on the same x (impossible after dedupe, but guard anyway).
  let slopePerDay = 0;
  if (denom > 0) {
    slopePerDay = (sumXY - n * meanX * meanY) / denom;
  }
  const intercept = meanY - slopePerDay * meanX;

  // Clamp slope in kg/week to keep wild trajectories tame.
  const maxSlopePerDay = slopeClampKgPerWeek / 7;
  if (slopePerDay > maxSlopePerDay) slopePerDay = maxSlopePerDay;
  if (slopePerDay < -maxSlopePerDay) slopePerDay = -maxSlopePerDay;

  // Project forward day-by-day from the day AFTER `newest` (or today,
  // whichever is later) through targetDate inclusive.
  const todayMs = asUtcMidnight(today);
  let cursor = Math.max(newest.ms + MS_PER_DAY, todayMs + MS_PER_DAY);
  const endMs = asUtcMidnight(targetDate);
  if (cursor > endMs) return [];

  const projection = [];
  while (cursor <= endMs) {
    const xDays = (cursor - x0) / MS_PER_DAY;
    const weightKg = Math.round((intercept + slopePerDay * xDays) * 10) / 10;
    projection.push({
      date: toIsoDate(cursor),
      weightKg,
      isProjection: true,
    });
    cursor += MS_PER_DAY;
    // Safety: cap at one year of forward projection. A 5-year goal would
    // generate 1825 points and bloat the response unnecessarily.
    if (projection.length >= 366) break;
  }

  return projection;
}

module.exports = {
  computeProjection,
  _internals: {
    DEFAULT_MIN_POINTS,
    DEFAULT_SLOPE_CLAMP_KG_PER_WEEK,
  },
};
