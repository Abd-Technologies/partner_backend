// Phase A — Progress Screen rebuild.
//
// Pure function. Given two arrays of 0–10 symptom scores (this period,
// previous period) and the symptom key, returns a delta payload the
// controller can hand straight to the frontend.
//
// Why "lower is better" lives here: brief §3.5 explicitly asks the backend
// to encode direction semantics so the frontend can render green/red
// without knowing the symptom. Bloating and cramps are scored 0–10 where
// higher = worse; energy and mood are scored 0–10 where higher = better.
// The same numeric delta means opposite things depending on which symptom.
//
// Output shape:
//   {
//     key:           string,
//     intensityPct:  number | null,         // 0..100
//     deltaPct:      number | null,         // signed; rounded to integer
//     direction:     'improvement' | 'regression' | 'unchanged' | null,
//     notEnoughData: boolean,
//     basedOn:       { current: number, previous: number },
//   }

const MIN_DATAPOINTS_PER_PERIOD = 5;
const UNCHANGED_TOLERANCE_PCT = 5;

const LOWER_IS_BETTER = new Set([
  'bloating',
  'cramps',
  'cramp',          // tolerate either spelling
]);
const HIGHER_IS_BETTER = new Set([
  'energy',
  'mood',
]);

function average(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function cleanScores(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    if (n < 0 || n > 10) continue;
    out.push(n);
  }
  return out;
}

function classify(key) {
  const lower = String(key || '').toLowerCase();
  if (LOWER_IS_BETTER.has(lower)) return 'lower_is_better';
  if (HIGHER_IS_BETTER.has(lower)) return 'higher_is_better';
  // Default to higher-is-better (matches mood/energy semantics) so a
  // future symptom we forgot to register doesn't render red incorrectly.
  return 'higher_is_better';
}

/**
 * @param {string} key
 * @param {Array<number|null>} currentPeriodScores
 * @param {Array<number|null>} previousPeriodScores
 * @returns {object}
 */
function computeSymptomDelta(key, currentPeriodScores, previousPeriodScores) {
  const current = cleanScores(currentPeriodScores);
  const previous = cleanScores(previousPeriodScores);

  if (current.length < MIN_DATAPOINTS_PER_PERIOD
      || previous.length < MIN_DATAPOINTS_PER_PERIOD) {
    return {
      key,
      intensityPct: current.length > 0
        ? Math.round((average(current) / 10) * 100)
        : null,
      deltaPct: null,
      direction: null,
      notEnoughData: true,
      basedOn: { current: current.length, previous: previous.length },
    };
  }

  const currentAvg = average(current);
  const previousAvg = average(previous);
  const intensityPct = Math.round((currentAvg / 10) * 100);

  // Edge: previous avg is 0. A "% change" formula would divide by zero. We
  // flatten to a flat delta in score units, scaled to 100 for UI parity.
  let deltaPct;
  if (previousAvg === 0) {
    deltaPct = Math.round((currentAvg - previousAvg) * 10);
  } else {
    deltaPct = Math.round(((currentAvg - previousAvg) / previousAvg) * 100);
  }

  let direction;
  const semantics = classify(key);
  if (Math.abs(deltaPct) < UNCHANGED_TOLERANCE_PCT) {
    direction = 'unchanged';
  } else if (semantics === 'lower_is_better') {
    direction = deltaPct < 0 ? 'improvement' : 'regression';
  } else {
    direction = deltaPct > 0 ? 'improvement' : 'regression';
  }

  return {
    key,
    intensityPct,
    deltaPct,
    direction,
    notEnoughData: false,
    basedOn: { current: current.length, previous: previous.length },
  };
}

module.exports = {
  computeSymptomDelta,
  _internals: { MIN_DATAPOINTS_PER_PERIOD, UNCHANGED_TOLERANCE_PCT },
};
