/**
 * Shared utilities for all re-engagement / lifecycle notification channels.
 *
 * Import from here — NEVER copy-paste these functions into segment files.
 * If you need a new shared utility, add it here.
 */

const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { UserCycleData, UserNotification, UserPlan, Plan, TrialJourney } = require('../../models');
const CyclePhaseCalculator = require('../CyclePhaseCalculator');

// Phase hooks — appended to the notification body when the user's cycle phase
// is known. Keeps each message feeling personal.
const PHASE_HOOK = {
  menstrual:  "Rest is part of the process — we'll be here when you're ready.",
  follicular: "Your energy is rising — the perfect time to get back.",
  ovulatory:  "You're at peak strength right now. Don't let it go to waste.",
  luteal:     "Lighter training this week — we have the perfect classes for this phase.",
};

/**
 * Append a phase-specific hook to the base message body.
 * Returns base unchanged if phase is null/unknown.
 */
function buildBody(base, phase) {
  const hook = phase ? PHASE_HOOK[phase] : null;
  return hook ? `${base} ${hook}` : base;
}

/**
 * Look up the user's current cycle phase.
 * Prefers the server-cached UserCycleData.currentPhase.
 * Falls back to CyclePhaseCalculator if currentPhase is null but
 * lastPeriodDate is set. Returns null if cycle data is unavailable.
 */
async function getPhase(userId) {
  try {
    const cd = await UserCycleData.findOne({
      where:      { userId, dataProvided: 1 },
      attributes: ['currentPhase', 'lastPeriodDate', 'averageCycleLength'],
    });
    if (!cd) return null;
    if (cd.currentPhase) return cd.currentPhase;
    if (!cd.lastPeriodDate) return null;
    const result = CyclePhaseCalculator.calculate({
      lastPeriodDate:     new Date(cd.lastPeriodDate),
      averageCycleLength: cd.averageCycleLength || 28,
    });
    return result?.phase || null;
  } catch {
    return null;
  }
}

/**
 * Returns true if this notification type was EVER sent to this user.
 * Used for bucket-based sequences where each type fires exactly once.
 *
 * Different from recentlySent() which is a rolling time window.
 * Use hasEverSent() for lifecycle/re-engagement buckets.
 * Use recentlySent() only when you want a repeat (e.g. weekly digest).
 */
async function hasEverSent(userId, type) {
  const row = await UserNotification.findOne({
    where:      { userId, type },
    attributes: ['id'],
  });
  return !!row;
}

/**
 * Returns true if this type was sent within the last N days.
 * Use for repeating notifications (e.g. downloadNudge 7-day cooldown,
 * trialJourney state-machine nudges with per-state cooldown).
 */
async function recentlySent(userId, type, withinDays) {
  const since = moment().subtract(withinDays, 'days').toDate();
  const row = await UserNotification.findOne({
    where: { userId, type, sentAt: { [Op.gte]: since } },
    attributes: ['id'],
  });
  return !!row;
}

/**
 * Returns a Set of userIds who have at least one non-free-trial paid UserPlan.
 * These users are handled exclusively by lifecycle.js — exclude from other channels.
 *
 * Note: free trial UserPlans are destroyed on expiry (AdminController ~line 2911),
 * so only active/expired paid plans appear here.
 */
async function getPaidPlanUserIds() {
  const rows = await UserPlan.findAll({
    include: [{
      model:    Plan,
      required: true,
      where:    { title: { [Op.ne]: 'Free Trial' } },
      attributes: [],
    }],
    attributes: ['userId'],
  });
  return new Set(rows.map((r) => r.userId));
}

/**
 * Returns a Set of userIds who have a TrialJourney row (started the 3-day trial).
 * These users are handled exclusively by trialJourney.js — exclude from downloaded.js
 * so the two channels never overlap.
 */
async function getTrialJourneyUserIds() {
  const rows = await TrialJourney.findAll({ attributes: ['userId'] });
  return new Set(rows.map((r) => r.userId));
}

module.exports = {
  PHASE_HOOK,
  buildBody,
  getPhase,
  hasEverSent,
  recentlySent,
  getPaidPlanUserIds,
  getTrialJourneyUserIds,
};
