/**
 * Free trial gate: the trial (and its day clock) only starts once she has
 * finished the trial setup in the app: every step answered, the review
 * screen confirmed and the health consent ticked. Pregnant women and new
 * mothers still inside their recovery time can't start it either.
 *
 * Turn off with TRIAL_REQUIRE_ONBOARDING=false in .env (for example while
 * an older app version without the setup screens is still in use).
 */
const { PreConsultationProfile } = require('../models');
const lifeStage = require('./lifeStage');

const NOT_DONE = 'Please finish your trial setup first. It only takes a minute.';
const NOT_YET = "Your free trial isn't open for you yet. We'll let you know as soon as it is.";

function gateOn() {
  return String(process.env.TRIAL_REQUIRE_ONBOARDING || 'true').toLowerCase() !== 'false';
}

function asJson(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch (e) { return {}; }
}

/** Returns null when she may start the trial, else { message, reason }. */
async function trialStartBlock(userId) {
  if (!gateOn()) return null;
  const p = await PreConsultationProfile.findOne({ where: { userId } });
  const ws = asJson(p && p.workoutSection);
  const done =
    p &&
    p.isComplete === true &&
    p.healthConsentAt &&
    p.goals &&
    ws.fitnessLevel;
  if (!done) return { message: NOT_DONE, reason: 'onboarding_incomplete' };
  try {
    const ls = await lifeStage.getLifeStage(userId);
    if (ls && ls.access && ls.access !== 'full') {
      return { message: NOT_YET, reason: 'life_stage' };
    }
  } catch (e) {
    console.error('[trialEligibility] life stage check failed', e.message);
  }
  return null;
}

module.exports = { trialStartBlock };
