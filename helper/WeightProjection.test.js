// Run with: node --test partner_backend/helper/WeightProjection.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeProjection } = require('./WeightProjection');

test('returns [] when no logs', () => {
  assert.deepEqual(
    computeProjection([], { targetDate: '2026-06-30', today: '2026-04-27' }),
    [],
  );
});

test('returns [] when fewer than 3 points', () => {
  const logs = [
    { date: '2026-04-01', weightKg: 70 },
    { date: '2026-04-08', weightKg: 69.5 },
  ];
  assert.deepEqual(
    computeProjection(logs, { targetDate: '2026-06-30', today: '2026-04-27' }),
    [],
  );
});

test('returns [] when targetDate is missing', () => {
  const logs = [
    { date: '2026-04-01', weightKg: 70 },
    { date: '2026-04-08', weightKg: 69.5 },
    { date: '2026-04-15', weightKg: 69 },
  ];
  assert.deepEqual(computeProjection(logs, { today: '2026-04-27' }), []);
});

test('produces a downward line for steady weight loss', () => {
  // 5 weekly points dropping ~0.4 kg/week (within the ±0.5 clamp).
  const logs = [
    { date: '2026-04-01', weightKg: 70.0 },
    { date: '2026-04-08', weightKg: 69.6 },
    { date: '2026-04-15', weightKg: 69.2 },
    { date: '2026-04-22', weightKg: 68.8 },
    { date: '2026-04-29', weightKg: 68.4 },
  ];
  const proj = computeProjection(logs, {
    targetDate: '2026-05-29', // 30 days after newest
    today: '2026-04-29',
  });

  assert.ok(proj.length > 0, 'should produce a projection');
  // First point is the day after the newest log.
  assert.equal(proj[0].date, '2026-04-30');
  // Last point lines up with the targetDate.
  assert.equal(proj[proj.length - 1].date, '2026-05-29');
  // Trend is downward.
  assert.ok(proj[proj.length - 1].weightKg < proj[0].weightKg);
  // Every point is flagged as projection.
  for (const p of proj) assert.equal(p.isProjection, true);
});

test('clamps an extreme slope to ±0.5 kg/week', () => {
  // Logs imply ~5 kg/week loss — a 30-day extrapolation would be silly.
  // Slope must be clamped, so 30 days forward we can't be more than
  // 30/7 * 0.5 ≈ 2.14 kg below the latest point.
  const logs = [
    { date: '2026-04-01', weightKg: 80 },
    { date: '2026-04-08', weightKg: 75 },
    { date: '2026-04-15', weightKg: 70 },
  ];
  const proj = computeProjection(logs, {
    targetDate: '2026-05-15',
    today: '2026-04-15',
  });
  const lastWeight = proj[proj.length - 1].weightKg;
  // 30 days × 0.5/7 ≈ 2.14. Allow 0.05 kg float jitter from rounding.
  assert.ok(
    lastWeight >= 70 - 2.2,
    `last projected weight ${lastWeight} should be clamped, expected ≥ 67.8`,
  );
});

test('returns [] when targetDate is before today', () => {
  const logs = [
    { date: '2026-04-01', weightKg: 70 },
    { date: '2026-04-08', weightKg: 69.5 },
    { date: '2026-04-15', weightKg: 69 },
  ];
  assert.deepEqual(
    computeProjection(logs, { targetDate: '2026-03-01', today: '2026-04-15' }),
    [],
  );
});

test('30-day window — points outside the window are ignored', () => {
  // 2 ancient points + 3 recent points — should still produce a projection
  // based on the recent 3 only.
  const logs = [
    { date: '2025-01-01', weightKg: 100 },
    { date: '2025-02-01', weightKg: 95 },
    { date: '2026-04-01', weightKg: 70 },
    { date: '2026-04-08', weightKg: 69.5 },
    { date: '2026-04-15', weightKg: 69 },
  ];
  const proj = computeProjection(logs, {
    targetDate: '2026-05-15',
    today: '2026-04-15',
  });
  assert.ok(proj.length > 0);
  // First projected point should be near 69, not near 70 (which the
  // ancient-points-included regression would predict).
  assert.ok(proj[0].weightKg < 69.5);
});

test('null weight values are skipped', () => {
  const logs = [
    { date: '2026-04-01', weightKg: 70 },
    { date: '2026-04-05', weightKg: null },
    { date: '2026-04-08', weightKg: 69.5 },
    { date: '2026-04-15', weightKg: 69 },
  ];
  const proj = computeProjection(logs, {
    targetDate: '2026-05-01',
    today: '2026-04-15',
  });
  assert.ok(proj.length > 0);
});

test('projection capped at 366 days forward', () => {
  const logs = [
    { date: '2026-04-01', weightKg: 70 },
    { date: '2026-04-08', weightKg: 69.5 },
    { date: '2026-04-15', weightKg: 69 },
  ];
  const proj = computeProjection(logs, {
    // 5 years out — way past the 1-year cap.
    targetDate: '2031-04-01',
    today: '2026-04-15',
  });
  assert.ok(proj.length <= 366, `got ${proj.length} points, expected ≤ 366`);
});

test('flat trend produces flat projection', () => {
  const logs = [
    { date: '2026-04-01', weightKg: 70 },
    { date: '2026-04-08', weightKg: 70 },
    { date: '2026-04-15', weightKg: 70 },
    { date: '2026-04-22', weightKg: 70 },
  ];
  const proj = computeProjection(logs, {
    targetDate: '2026-05-22',
    today: '2026-04-22',
  });
  assert.ok(proj.length > 0);
  for (const p of proj) {
    assert.ok(Math.abs(p.weightKg - 70) < 0.1, `expected ~70, got ${p.weightKg}`);
  }
});
