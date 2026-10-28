'use strict';
/**
 * Hormonal engine: learns her real cycle length (Oct 2026).
 *
 * Each time she logs a NEW period start, the days since her previous
 * period start is one real cycle. We keep her last 6 (cycleHistory) and
 * predict with them:
 *   1 real cycle   -> halfway between what she told us and that cycle
 *   2+ real cycles -> the average of her real cycles
 * Gaps under 18 or over 50 days are ignored (a correction or a missed
 * month, not a real cycle).
 */
const MIN_GAP = 18;
const MAX_GAP = 50;
const KEEP = 6;

function historyOf(row) {
  try {
    const v = row && row.cycleHistory;
    const arr = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(arr) ? arr.map(Number).filter((n) => n >= MIN_GAP && n <= MAX_GAP) : [];
  } catch (_) {
    return [];
  }
}

function dayNumber(d) {
  const x = new Date(d);
  if (isNaN(x.getTime())) return null;
  return Math.floor(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86400000);
}

/**
 * @param row         her current UserCycleData (before saving)
 * @param newDate     the period date being saved
 * @param typedLength the cycle length sent by the app (what she told us)
 * @returns { averageCycleLength?, cycleHistory? } — fields to save
 */
function learn(row, newDate, typedLength) {
  const out = {};
  const history = historyOf(row);
  const told = Number(typedLength) || Number(row && row.averageCycleLength) || 28;
  const oldDay = row && row.lastPeriodDate ? dayNumber(row.lastPeriodDate) : null;
  const newDay = newDate ? dayNumber(newDate) : null;

  if (oldDay != null && newDay != null && newDay > oldDay) {
    const gap = newDay - oldDay;
    if (gap >= MIN_GAP && gap <= MAX_GAP) {
      history.push(gap);
      while (history.length > KEEP) history.shift();
      out.cycleHistory = JSON.stringify(history);
    }
  }

  if (history.length >= 2) {
    out.averageCycleLength = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
  } else if (history.length === 1) {
    out.averageCycleLength = Math.round((told + history[0]) / 2);
  }
  return out;
}

module.exports = { learn, historyOf };
