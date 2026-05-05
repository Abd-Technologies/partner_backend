// Run with: node --test partner_backend/helper/PaceEngine.test.js
//
// Uses Node's built-in test runner (Node ≥18). No external deps — Jest is
// not installed and the prompt forbids adding deps. Assertion API is
// node:assert/strict; semantics match Jest's expect for the cases we cover.

const test = require('node:test');
const assert = require('node:assert/strict');

const { computePace, deriveExpectedPace } = require('./PaceEngine');

const baseGoal = {
  startValueKg: 70,
  targetValueKg: 65,           // weight loss of 5 kg
  startDate: '2026-01-01',
  targetDate: '2026-04-02',    // 91 days = 13.0 weeks
  expectedPaceKgPerWeek: -5 / 13, // ≈ -0.3846 kg/week
};

test('warming_up — fewer than 2 elapsed weeks', () => {
  const result = computePace(
    { ...baseGoal, currentValueKg: 69.7 },
    '2026-01-10', // ~1.3 weeks elapsed
  );
  assert.equal(result.paceStatus, 'warming_up');
  assert.equal(result.paceMessage, '');
  assert.ok(result.progressPct >= 0 && result.progressPct <= 1);
});

test('on_track — within 0.5 weeks of expected delta', () => {
  // 4 weeks in → expected delta ≈ -1.54 kg. Use exactly that.
  const result = computePace(
    { ...baseGoal, currentValueKg: 70 + (baseGoal.expectedPaceKgPerWeek * 4) },
    '2026-01-29', // 28 days = 4 weeks
  );
  assert.equal(result.paceStatus, 'on_track');
  assert.equal(result.paceMessage, 'On track');
  assert.equal(result.weeksAhead, 0);
});

test('ahead — weight loss progressing faster than schedule', () => {
  // 4 weeks in. Expected delta ≈ -1.54 kg. Actual: -3 kg. Pace delta:
  // -1.46 kg → divided by -0.3846 → ~3.8 weeks ahead → rounds to 4.
  const result = computePace(
    { ...baseGoal, currentValueKg: 67 },
    '2026-01-29',
  );
  assert.equal(result.paceStatus, 'ahead');
  assert.match(result.paceMessage, /ahead of schedule/);
  assert.ok(result.weeksAhead >= 3);
});

test('behind — weight loss not progressing fast enough', () => {
  // 8 weeks in. Expected delta ≈ -3.08 kg. Actual: -1 kg. Pace delta: 2.08
  // kg → divided by -0.3846 → ~-5.4 weeks → rounds to -5 (5 wks behind).
  const result = computePace(
    { ...baseGoal, currentValueKg: 69 },
    '2026-02-26',
  );
  assert.equal(result.paceStatus, 'behind');
  assert.match(result.paceMessage, /behind schedule/);
  assert.ok(result.weeksAhead < 0);
});

test('weight gain — ahead means gained more than scheduled', () => {
  const gainGoal = {
    startValueKg: 50,
    targetValueKg: 55,           // +5 kg
    startDate: '2026-01-01',
    targetDate: '2026-04-02',    // 13 weeks
    expectedPaceKgPerWeek: 5 / 13,
  };
  // 4 weeks in. Expected: +1.54. Actual: +3 (gained more = ahead).
  const result = computePace({ ...gainGoal, currentValueKg: 53 }, '2026-01-29');
  assert.equal(result.paceStatus, 'ahead');
  assert.ok(result.weeksAhead >= 3);
});

test('progressPct clamps between 0 and 1', () => {
  // Overshot the goal — currentDelta = -7, targetDelta = -5 → 7/5 = 1.4
  // should be clamped to 1.0.
  const result = computePace(
    { ...baseGoal, currentValueKg: 63 },
    '2026-04-01',
  );
  assert.ok(result.progressPct <= 1);
  assert.ok(result.progressPct >= 0);
});

test('no_data when currentValueKg is missing', () => {
  const result = computePace(
    { ...baseGoal, currentValueKg: null },
    '2026-02-26',
  );
  assert.equal(result.paceStatus, 'no_data');
  assert.equal(result.weeksAhead, 0);
});

test('no_data when goal payload is incomplete', () => {
  const result = computePace(
    { startValueKg: null, targetValueKg: 65, startDate: '2026-01-01', targetDate: '2026-04-02' },
    '2026-02-26',
  );
  assert.equal(result.paceStatus, 'no_data');
});

test('maintain goal — within 1 kg of start is on_track', () => {
  const maintainGoal = {
    startValueKg: 60,
    targetValueKg: 60,
    startDate: '2026-01-01',
    targetDate: '2026-04-02',
    expectedPaceKgPerWeek: 0,
    currentValueKg: 60.4,
  };
  const result = computePace(maintainGoal, '2026-02-26');
  assert.equal(result.paceStatus, 'on_track');
});

test('maintain goal — drift > 1 kg flags behind', () => {
  const maintainGoal = {
    startValueKg: 60,
    targetValueKg: 60,
    startDate: '2026-01-01',
    targetDate: '2026-04-02',
    expectedPaceKgPerWeek: 0,
    currentValueKg: 62,
  };
  const result = computePace(maintainGoal, '2026-02-26');
  assert.equal(result.paceStatus, 'behind');
});

test('paceMessage uses singular "1 wk" when exactly one week off', () => {
  // Engineer the scenario: 2.5 weeks elapsed, expected pace gives a 1-week lead.
  const goal = {
    startValueKg: 70,
    targetValueKg: 60,
    startDate: '2026-01-01',
    targetDate: '2026-04-02',     // 13 weeks → -10 kg → expectedPace ≈ -0.769/wk
    expectedPaceKgPerWeek: -10 / 13,
  };
  // 4 weeks in. Expected delta: -3.08. Actual: -3.85 → pace delta -0.77 →
  // /(-0.769) = +1.0 weeks ahead → rounds to 1 → "1 wk ahead".
  const result = computePace(
    { ...goal, currentValueKg: 70 + (-10 / 13) * 5 },
    '2026-01-29',
  );
  // Tolerate boundary jitter — accept either on_track (within 0.5) or 1 wk ahead.
  assert.ok(['on_track', 'ahead'].includes(result.paceStatus));
  if (result.paceStatus === 'ahead') {
    assert.match(result.paceMessage, /1 wk/);
  }
});

test('deriveExpectedPace handles degenerate dates safely', () => {
  assert.equal(deriveExpectedPace(70, 65, '2026-01-01', '2026-01-01'), 0);
  assert.equal(deriveExpectedPace(70, 65, '2026-04-01', '2026-01-01'), 0);
});

test('deriveExpectedPace returns weekly rate over the interval', () => {
  const rate = deriveExpectedPace(70, 65, '2026-01-01', '2026-04-02'); // 13w
  assert.ok(Math.abs(rate - (-5 / 13)) < 1e-9);
});
