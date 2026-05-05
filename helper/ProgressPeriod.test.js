// Run with: node --test partner_backend/helper/ProgressPeriod.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePeriod, ALLOWED_PERIODS, DEFAULT_PERIOD } = require('./ProgressPeriod');

test('default period is month when missing', () => {
  const out = resolvePeriod(undefined, '2026-04-27');
  assert.equal(out.key, 'month');
});

test('unknown period falls back to default (month)', () => {
  const out = resolvePeriod('lifetime', '2026-04-27');
  assert.equal(out.key, DEFAULT_PERIOD);
});

test('all 5 documented periods are accepted', () => {
  for (const p of ALLOWED_PERIODS) {
    const out = resolvePeriod(p, '2026-04-27');
    assert.equal(out.key, p);
  }
});

test('month — calendar-aligned including last day', () => {
  // Brief sample: asOf=2026-04-27 → period_start=2026-04-01.
  const out = resolvePeriod('month', '2026-04-27');
  assert.equal(out.start, '2026-04-01');
  assert.equal(out.end, '2026-04-30');
  assert.equal(out.previousStart, '2026-03-01');
  assert.equal(out.previousEnd, '2026-03-31');
});

test('month boundary — Jan 1 of a year', () => {
  const out = resolvePeriod('month', '2026-01-01');
  assert.equal(out.start, '2026-01-01');
  assert.equal(out.end, '2026-01-31');
  assert.equal(out.previousStart, '2025-12-01');
  assert.equal(out.previousEnd, '2025-12-31');
});

test('week — Monday to Sunday containing asOf', () => {
  // 2026-04-27 is a Monday → week starts that day.
  const out = resolvePeriod('week', '2026-04-27');
  assert.equal(out.start, '2026-04-27');
  assert.equal(out.end, '2026-05-03');
  assert.equal(out.previousStart, '2026-04-20');
  assert.equal(out.previousEnd, '2026-04-26');
});

test('week — Sunday treated as part of the prior Mon-Sun week', () => {
  // 2026-05-03 is a Sunday → still inside the week starting Mon 2026-04-27.
  const out = resolvePeriod('week', '2026-05-03');
  assert.equal(out.start, '2026-04-27');
  assert.equal(out.end, '2026-05-03');
});

test('3month — 3 calendar months ending in asOf month', () => {
  const out = resolvePeriod('3month', '2026-04-27');
  assert.equal(out.start, '2026-02-01');
  assert.equal(out.end, '2026-04-30');
  assert.equal(out.previousStart, '2025-11-01');
  assert.equal(out.previousEnd, '2026-01-31');
});

test('6month — 6 calendar months', () => {
  const out = resolvePeriod('6month', '2026-04-27');
  assert.equal(out.start, '2025-11-01');
  assert.equal(out.end, '2026-04-30');
});

test('year — Jan 1 to Dec 31 of asOf year', () => {
  const out = resolvePeriod('year', '2026-04-27');
  assert.equal(out.start, '2026-01-01');
  assert.equal(out.end, '2026-12-31');
  assert.equal(out.previousStart, '2025-01-01');
  assert.equal(out.previousEnd, '2025-12-31');
});

test('invalid asOf falls back to today silently', () => {
  // Should not throw, should not produce NaN dates.
  const out = resolvePeriod('month', 'not-a-date');
  assert.match(out.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(out.end, /^\d{4}-\d{2}-\d{2}$/);
});

test('emits both string dates and ms timestamps for SQL filters', () => {
  const out = resolvePeriod('month', '2026-04-27');
  assert.equal(typeof out.startMs, 'number');
  assert.equal(typeof out.endMs, 'number');
  assert.ok(out.endMs > out.startMs);
});

test('days count matches the inclusive window', () => {
  const out = resolvePeriod('week', '2026-04-27');
  assert.equal(out.days, 7);
  assert.equal(out.previousDays, 7);

  const month = resolvePeriod('month', '2026-04-27');
  assert.equal(month.days, 30); // April has 30 days
});
