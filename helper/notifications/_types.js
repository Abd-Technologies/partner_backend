/**
 * Central registry for all re-engagement / lifecycle notification types.
 *
 * How to add a new type:
 * 1. Add one entry here with prefKey and channel.
 * 2. Create or update the segment file in helper/notifications/.
 * 3. Wire a cron in app.js if needed.
 * That's it — notification.js picks up the new prefKey automatically.
 *
 * Fields:
 *   prefKey  — which column in NotificationPreference gates this type.
 *              'morningNudge' = controlled by the "Morning updates" toggle.
 *   channel  — which segment file owns this type (for audit/docs only).
 *
 * notification.js imports REENGAGEMENT_PREF_BY_TYPE and spreads it into
 * its own PREF_BY_TYPE map — you never need to edit notification.js for a
 * new re-engagement type.
 */

const REENGAGEMENT_TYPES = {
  // Downloaded — signed up, never started trial
  downloadNudge:      { prefKey: 'morningNudge', channel: 'downloaded' },

  // Trial churned — used admin-assigned free trial, didn't buy
  trialChurnEarly:    { prefKey: 'morningNudge', channel: 'trialChurned' },
  trialChurnMomentum: { prefKey: 'morningNudge', channel: 'trialChurned' },
  trialChurnMid:      { prefKey: 'morningNudge', channel: 'trialChurned' },
  trialChurnLate:     { prefKey: 'morningNudge', channel: 'trialChurned' },

  // Mid-package churn — paid plan active, account deactivated
  midPackageComfort:  { prefKey: 'morningNudge', channel: 'lifecycle' },
  midPackageModerate: { prefKey: 'morningNudge', channel: 'lifecycle' },
  midPackageUrgent:   { prefKey: 'morningNudge', channel: 'lifecycle' },

  // Post-package churn — paid plan expired, no renewal
  postPackageEarly:   { prefKey: 'morningNudge', channel: 'lifecycle' },
  postPackageKeep:    { prefKey: 'morningNudge', channel: 'lifecycle' },
  postPackageMid:     { prefKey: 'morningNudge', channel: 'lifecycle' },
  postPackageDrift:   { prefKey: 'morningNudge', channel: 'lifecycle' },
  postPackageLate:    { prefKey: 'morningNudge', channel: 'lifecycle' },

  // TrialJourney — 3-day trial, state-machine nudges (trialController.js)
  // Four state transitions, each repeating on a cooldown until the user acts.
  // Gated by morningNudge pref so users can silence them with one toggle.
  trialJourneyStart:   { prefKey: 'morningNudge', channel: 'trialJourney' },
  trialJourneyDay2:    { prefKey: 'morningNudge', channel: 'trialJourney' },
  trialJourneyDay3:    { prefKey: 'morningNudge', channel: 'trialJourney' },
  trialJourneyConvert: { prefKey: 'morningNudge', channel: 'trialJourney' },

  // TrialJourneyChurned — completed all 3 days, never converted to paid plan.
  // Highest-intent segment: attended 3 classes but didn't buy.
  // Picks up where trialJourney.js (trialJourneyConvert, day 15+) leaves off.
  // 4-bucket sequence anchored on day3AttendedAt, fires once per bucket ever.
  trialJourneyChurnEarly:    { prefKey: 'morningNudge', channel: 'trialJourneyChurned' },
  trialJourneyChurnMomentum: { prefKey: 'morningNudge', channel: 'trialJourneyChurned' },
  trialJourneyChurnMid:      { prefKey: 'morningNudge', channel: 'trialJourneyChurned' },
  trialJourneyChurnLate:     { prefKey: 'morningNudge', channel: 'trialJourneyChurned' },

  // Weekly check-in reminder — Sunday 19:00 PKT
  // Gated by its own weeklyCheckin pref column, independent of morningNudge.
  weeklyCheckin:       { prefKey: 'weeklyCheckin', channel: 'weeklyCheckin' },
};

/**
 * Flat { type: prefKey } map — spread into notification.js PREF_BY_TYPE.
 * Automatically stays in sync with REENGAGEMENT_TYPES above.
 */
const REENGAGEMENT_PREF_BY_TYPE = Object.fromEntries(
  Object.entries(REENGAGEMENT_TYPES).map(([type, def]) => [type, def.prefKey])
);

module.exports = { REENGAGEMENT_TYPES, REENGAGEMENT_PREF_BY_TYPE };
