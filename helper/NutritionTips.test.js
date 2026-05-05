// Run with: node --test partner_backend/helper/NutritionTips.test.js

const test = require('node:test');
const assert = require('node:assert/strict');

const { getPhaseTip, PHASES } = require('./NutritionTips');

test('returns tip for each known phase', () => {
  for (const phase of PHASES) {
    const out = getPhaseTip(phase);
    assert.equal(out.phase, phase);
    assert.equal(typeof out.tip, 'string');
    assert.ok(out.tip.length > 0);
    assert.equal(typeof out.macroEmphasis, 'string');
  }
});

test('null phase returns fallback with phase=null', () => {
  const out = getPhaseTip(null);
  assert.equal(out.phase, null);
  assert.match(out.tip, /hydrated/i);
  assert.equal(out.macroEmphasis, 'balanced');
});

test('undefined phase returns fallback', () => {
  const out = getPhaseTip(undefined);
  assert.equal(out.phase, null);
  assert.equal(out.macroEmphasis, 'balanced');
});

test('unknown phase falls back without throwing', () => {
  const out = getPhaseTip('made_up_phase');
  assert.equal(out.phase, null);
  assert.equal(out.macroEmphasis, 'balanced');
});

test('case-insensitive phase lookup', () => {
  const out = getPhaseTip('LUTEAL');
  assert.equal(out.phase, 'luteal');
  assert.equal(out.macroEmphasis, 'magnesium');
});

test('"ovulation" alias resolves to ovulatory', () => {
  // Brief v1 used 'ovulation'; CyclePhaseCalculator emits 'ovulatory'.
  // We accept either input.
  const out = getPhaseTip('ovulation');
  assert.equal(out.phase, 'ovulatory');
  assert.equal(out.macroEmphasis, 'fibre');
});

test('PHASES export covers the four canonical phases', () => {
  assert.deepEqual(
    [...PHASES].sort(),
    ['follicular', 'luteal', 'menstrual', 'ovulatory'],
  );
});
