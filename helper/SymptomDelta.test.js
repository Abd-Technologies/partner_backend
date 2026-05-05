// Run with: node --test partner_backend/helper/SymptomDelta.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeSymptomDelta } = require('./SymptomDelta');

test('not enough data — fewer than 5 in current period', () => {
  const out = computeSymptomDelta('bloating', [3, 4], [5, 5, 5, 5, 5, 5]);
  assert.equal(out.notEnoughData, true);
  assert.equal(out.deltaPct, null);
  assert.equal(out.direction, null);
});

test('not enough data — fewer than 5 in previous period', () => {
  const out = computeSymptomDelta('bloating', [3, 3, 3, 3, 3], [5, 5]);
  assert.equal(out.notEnoughData, true);
});

test('bloating dropping — flagged as improvement (lower is better)', () => {
  const out = computeSymptomDelta(
    'bloating',
    [2, 2, 2, 2, 2],     // avg 2 → 20%
    [5, 5, 5, 5, 5],     // avg 5
  );
  assert.equal(out.notEnoughData, false);
  assert.equal(out.intensityPct, 20);
  assert.equal(out.deltaPct, -60);
  assert.equal(out.direction, 'improvement');
});

test('bloating rising — flagged as regression (lower is better)', () => {
  const out = computeSymptomDelta(
    'bloating',
    [7, 7, 7, 7, 7],
    [3, 3, 3, 3, 3],
  );
  assert.equal(out.direction, 'regression');
  assert.ok(out.deltaPct > 0);
});

test('cramps key (singular and plural) — both treated as lower-is-better', () => {
  const dropping = [1, 1, 1, 1, 1];
  const wasHigh = [5, 5, 5, 5, 5];
  const a = computeSymptomDelta('cramps', dropping, wasHigh);
  const b = computeSymptomDelta('cramp', dropping, wasHigh);
  assert.equal(a.direction, 'improvement');
  assert.equal(b.direction, 'improvement');
});

test('energy rising — flagged as improvement (higher is better)', () => {
  const out = computeSymptomDelta(
    'energy',
    [8, 8, 8, 8, 8],
    [5, 5, 5, 5, 5],
  );
  assert.equal(out.direction, 'improvement');
  assert.ok(out.deltaPct > 0);
});

test('energy falling — flagged as regression (higher is better)', () => {
  const out = computeSymptomDelta(
    'energy',
    [3, 3, 3, 3, 3],
    [7, 7, 7, 7, 7],
  );
  assert.equal(out.direction, 'regression');
  assert.ok(out.deltaPct < 0);
});

test('unchanged when delta is within ±5% tolerance', () => {
  const out = computeSymptomDelta(
    'mood',
    [6, 6, 6, 6, 6.1],
    [6, 6, 6, 6, 6],
  );
  assert.equal(out.direction, 'unchanged');
});

test('previous avg is 0 — does not divide by zero', () => {
  const out = computeSymptomDelta(
    'bloating',
    [4, 4, 4, 4, 4],
    [0, 0, 0, 0, 0],
  );
  // Should not throw, should not return NaN/Infinity.
  assert.notEqual(out.deltaPct, null);
  assert.equal(Number.isFinite(out.deltaPct), true);
  assert.equal(out.direction, 'regression');
});

test('null and out-of-range values are dropped before counting', () => {
  // 7 entries but only 5 valid → just barely qualifies.
  const out = computeSymptomDelta(
    'energy',
    [null, 8, 11 /* out of range */, 8, 8, 8, 8],  // 5 valid: 8,8,8,8,8
    [5, 5, 5, 5, 5],
  );
  assert.equal(out.notEnoughData, false);
  assert.equal(out.intensityPct, 80);
  assert.equal(out.basedOn.current, 5);
});

test('intensityPct present even when not enough data for delta', () => {
  // 3 valid points in current — not enough for delta but enough to show
  // an intensity bar with no comparison.
  const out = computeSymptomDelta(
    'mood',
    [6, 7, 8],
    [],
  );
  assert.equal(out.notEnoughData, true);
  assert.equal(out.intensityPct, 70);
  assert.equal(out.deltaPct, null);
});

test('unknown symptom key falls back to higher-is-better', () => {
  // Engineer a delta where higher-is-better → improvement.
  const out = computeSymptomDelta(
    'made_up_symptom',
    [8, 8, 8, 8, 8],
    [5, 5, 5, 5, 5],
  );
  assert.equal(out.direction, 'improvement');
});

test('basedOn counts only valid datapoints', () => {
  const out = computeSymptomDelta(
    'energy',
    [null, 5, 5, 5, 5, 5],  // 5 valid
    [-1, 5, 5, 5, 5, 5],     // -1 invalid; 5 valid
  );
  assert.deepEqual(out.basedOn, { current: 5, previous: 5 });
});
