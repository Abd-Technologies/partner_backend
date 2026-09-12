/**
 * Re-engagement / lifecycle notification channels.
 *
 * Adding a new channel:
 * 1. Register the types in _types.js (one line each).
 * 2. Create a new file in this folder (e.g. weeklyCheckin.js).
 * 3. Import and export it here.
 * 4. Add a cron entry in app.js.
 *
 * Channel schedule:
 *   09:00 PKT daily  — downloaded              (signed up, never trialled)
 *   09:05 PKT daily  — trialChurned            (admin trial used, didn't convert)
 *   09:10 PKT daily  — trialJourney            (3-day trial, state-machine nudges)
 *   09:15 PKT daily  — trialJourneyChurned     (completed 3 days, never bought)
 *   10:00 PKT daily  — lifecycle               (paid plan mid/post-churn)
 *   19:00 PKT Sunday — weeklyCheckin           (active users, log weekly metrics)
 *
 * Shared utilities:
 * getPhase, hasEverSent, recentlySent, buildBody, getPaidPlanUserIds, getTrialJourneyUserIds
 *   => import from ./_shared   (never copy-paste into channel files)
 *
 * Type registry:
 * REENGAGEMENT_TYPES, REENGAGEMENT_PREF_BY_TYPE
 *   => import from ./_types    (notification.js reads this at startup)
 */

const { sendDownloadedUserNudges }      = require('./downloaded');
const { sendTrialChurnedNudges }        = require('./trialChurned');
const { sendTrialJourneyNudges }        = require('./trialJourney');
const { sendTrialJourneyChurnedNudges } = require('./trialJourneyChurned');
const { sendLifecycleNudges }           = require('./lifecycle');
const { sendWeeklyCheckinReminders }    = require('./weeklyCheckin');

module.exports = {
  sendDownloadedUserNudges,
  sendTrialChurnedNudges,
  sendTrialJourneyNudges,
  sendTrialJourneyChurnedNudges,
  sendLifecycleNudges,
  sendWeeklyCheckinReminders,
};
