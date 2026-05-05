// Phase B — Progress Screen rebuild.
//
// Resolves a `period` query string into a concrete date window plus its
// previous-period counterpart, so all six progress endpoints share the
// same calendar semantics. The brief sample shows period_start = first of
// calendar month, so we use calendar-aligned windows (not rolling).
//
//   week     → ISO Mon–Sun containing asOf
//   month    → 1st → last of asOf's calendar month
//   3month   → 1st of (month - 2) → last of asOf's month
//   6month   → 1st of (month - 5) → last of asOf's month
//   year     → Jan 1 → Dec 31 of asOf's year
//
// Previous period mirrors the current with the same length, immediately
// preceding it.
//
// All dates are 'YYYY-MM-DD' strings (DATEONLY-friendly). UTC math
// throughout so server-tz drift can't bleed into bucket boundaries.

const ALLOWED_PERIODS = ['week', 'month', '3month', '6month', 'year'];
const DEFAULT_PERIOD = 'month';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function startOfIsoWeekUtc(utcMs) {
  const d = new Date(utcMs);
  // getUTCDay: 0=Sun..6=Sat. ISO week starts Monday.
  const dayOfWeek = d.getUTCDay();
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return utcMs + offsetToMonday * MS_PER_DAY;
}

function startOfMonthUtc(utcMs) {
  const d = new Date(utcMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function endOfMonthUtc(utcMs) {
  const d = new Date(utcMs);
  // Day 0 of the next month = last day of current month.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
}

function addMonthsUtc(utcMs, n) {
  const d = new Date(utcMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate());
}

function startOfYearUtc(utcMs) {
  const d = new Date(utcMs);
  return Date.UTC(d.getUTCFullYear(), 0, 1);
}

function endOfYearUtc(utcMs) {
  const d = new Date(utcMs);
  return Date.UTC(d.getUTCFullYear(), 11, 31);
}

function normalizePeriod(period) {
  if (!period) return DEFAULT_PERIOD;
  const lower = String(period).toLowerCase();
  return ALLOWED_PERIODS.includes(lower) ? lower : DEFAULT_PERIOD;
}

function parseAsOf(asOf) {
  if (!asOf) return new Date();
  // Tolerate 'YYYY-MM-DD' and ISO timestamps. Reject anything Date can't
  // parse so callers get a clean default rather than NaN-buckets.
  const d = new Date(asOf);
  if (!Number.isFinite(d.getTime())) return new Date();
  return d;
}

/**
 * @param {string} rawPeriod
 * @param {string|Date|null} rawAsOf
 * @returns {{
 *   key: 'week'|'month'|'3month'|'6month'|'year',
 *   start: string, end: string,
 *   previousStart: string, previousEnd: string,
 *   startMs: number, endMs: number,
 *   previousStartMs: number, previousEndMs: number,
 *   days: number, previousDays: number
 * }}
 */
function resolvePeriod(rawPeriod, rawAsOf) {
  const period = normalizePeriod(rawPeriod);
  const asOf = parseAsOf(rawAsOf);
  const asOfMs = asUtcMidnight(asOf);

  let startMs;
  let endMs;
  let previousStartMs;
  let previousEndMs;

  switch (period) {
    case 'week': {
      startMs = startOfIsoWeekUtc(asOfMs);
      endMs = startMs + 6 * MS_PER_DAY;
      previousEndMs = startMs - MS_PER_DAY;
      previousStartMs = previousEndMs - 6 * MS_PER_DAY;
      break;
    }
    case 'month': {
      startMs = startOfMonthUtc(asOfMs);
      endMs = endOfMonthUtc(asOfMs);
      previousEndMs = startMs - MS_PER_DAY;
      previousStartMs = startOfMonthUtc(previousEndMs);
      break;
    }
    case '3month': {
      const monthStart = startOfMonthUtc(asOfMs);
      startMs = addMonthsUtc(monthStart, -2);
      endMs = endOfMonthUtc(asOfMs);
      previousEndMs = startMs - MS_PER_DAY;
      previousStartMs = addMonthsUtc(startOfMonthUtc(previousEndMs), -2);
      break;
    }
    case '6month': {
      const monthStart = startOfMonthUtc(asOfMs);
      startMs = addMonthsUtc(monthStart, -5);
      endMs = endOfMonthUtc(asOfMs);
      previousEndMs = startMs - MS_PER_DAY;
      previousStartMs = addMonthsUtc(startOfMonthUtc(previousEndMs), -5);
      break;
    }
    case 'year':
    default: {
      startMs = startOfYearUtc(asOfMs);
      endMs = endOfYearUtc(asOfMs);
      previousStartMs = Date.UTC(new Date(startMs).getUTCFullYear() - 1, 0, 1);
      previousEndMs = Date.UTC(new Date(startMs).getUTCFullYear() - 1, 11, 31);
      break;
    }
  }

  return {
    key: period,
    start: toIsoDate(startMs),
    end: toIsoDate(endMs),
    previousStart: toIsoDate(previousStartMs),
    previousEnd: toIsoDate(previousEndMs),
    startMs,
    endMs,
    previousStartMs,
    previousEndMs,
    days: Math.round((endMs - startMs) / MS_PER_DAY) + 1,
    previousDays: Math.round((previousEndMs - previousStartMs) / MS_PER_DAY) + 1,
  };
}

module.exports = {
  resolvePeriod,
  ALLOWED_PERIODS,
  DEFAULT_PERIOD,
  // Exposed for tests.
  _internals: { asUtcMidnight, toIsoDate, startOfIsoWeekUtc, startOfMonthUtc, endOfMonthUtc },
};
