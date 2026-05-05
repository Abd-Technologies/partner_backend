// Run with: node --test partner_backend/helper/ProgressBuilders.test.js
//
// These tests cover the pure parts of ProgressBuilders that don't touch
// the DB. The DB-bound builders are exercised by the Postman collection
// (B9) against staging data, since unit-mocking Sequelize would be more
// brittle than valuable here.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPhaseSegments,
  buildHubInsights,
  buildUserBlock,
  _internals,
} = require('./ProgressBuilders');

test('buildUserBlock — null user returns null', () => {
  assert.equal(buildUserBlock(null), null);
});

test('buildUserBlock — emits firstName and image, blanks default to safe', () => {
  const block = buildUserBlock({ firstName: 'Shaista', image: 'p.jpg' });
  assert.deepEqual(block, { firstName: 'Shaista', image: 'p.jpg' });

  const blockNoImage = buildUserBlock({ firstName: 'Sam', image: null });
  assert.equal(blockNoImage.image, null);
});

test('buildPhaseSegments — empty history returns empty', () => {
  assert.deepEqual(buildPhaseSegments([]), []);
});

test('buildPhaseSegments — groups contiguous same-phase runs', () => {
  const history = [
    { date: '2026-04-01', weightKg: 70, phase: 'menstrual' },
    { date: '2026-04-08', weightKg: 69.8, phase: 'follicular' },
    { date: '2026-04-15', weightKg: 69.5, phase: 'follicular' },
    { date: '2026-04-22', weightKg: 69.2, phase: 'luteal' },
  ];
  const segs = buildPhaseSegments(history);
  assert.equal(segs.length, 3);
  assert.deepEqual(segs[0], { phase: 'menstrual', start: '2026-04-01', end: '2026-04-01' });
  assert.deepEqual(segs[1], { phase: 'follicular', start: '2026-04-08', end: '2026-04-15' });
  assert.deepEqual(segs[2], { phase: 'luteal', start: '2026-04-22', end: '2026-04-22' });
});

test('buildPhaseSegments — null phases break segments cleanly', () => {
  const history = [
    { date: '2026-04-01', weightKg: 70, phase: 'menstrual' },
    { date: '2026-04-08', weightKg: 69.8, phase: null },
    { date: '2026-04-15', weightKg: 69.5, phase: 'follicular' },
  ];
  const segs = buildPhaseSegments(history);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].phase, 'menstrual');
  assert.equal(segs[1].phase, 'follicular');
});

test('buildHubInsights — no cycle data returns generic tips', () => {
  const out = buildHubInsights(null, 3);
  assert.ok(out.insights.length > 0);
  assert.equal(out.isStatic, true);
  assert.match(out.honestyBanner, /learning/i);
  for (const ins of out.insights) assert.equal(typeof ins.body, 'string');
});

test('buildHubInsights — phase + cycleDay returns phase-aware tips', () => {
  const out = buildHubInsights({ phase: 'follicular', cycleDay: 8, hasData: true }, 3);
  assert.equal(out.insights.length, 3);
  assert.equal(out.insights[0].subtitle.toLowerCase().includes('follicular'), true);
});

test('buildHubInsights — limit clamped between 1 and 10', () => {
  const out0 = buildHubInsights(null, 0);
  assert.ok(out0.insights.length >= 1);

  const outBig = buildHubInsights(null, 999);
  assert.ok(outBig.insights.length <= 10);
});

test('buildHubInsights — duplicate template texts deduped', () => {
  const out = buildHubInsights({ phase: 'ovulatory', cycleDay: 14, hasData: true }, 5);
  const texts = new Set(out.insights.map((i) => i.body));
  assert.equal(texts.size, out.insights.length);
});

test('safeAvg returns null on empty input', () => {
  assert.equal(_internals.safeAvg([]), null);
  assert.equal(_internals.safeAvg(null), null);
});

test('safeAvg rounds to specified decimals', () => {
  assert.equal(_internals.safeAvg([1, 2, 3], 1), 2);
  assert.equal(_internals.safeAvg([1, 2, 4], 2), 2.33);
});

test('deriveHeadline — em-dash split returns the lead phrase', () => {
  const out = _internals.deriveHeadline('Day 1 - Take it easy. Body needs rest.');
  assert.equal(out, 'Day 1');
});

test('deriveHeadline — falls back to first sentence when no dash', () => {
  const out = _internals.deriveHeadline('Eat breakfast. Drink water.');
  assert.equal(out, 'Eat breakfast');
});

test('SYMPTOM_FIELDS — exposes the 4 v1 symptoms', () => {
  const keys = _internals.SYMPTOM_FIELDS.map((f) => f.key);
  assert.deepEqual(keys.sort(), ['bloating', 'cramps', 'energy', 'mood']);
});
