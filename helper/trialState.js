/**
 * Shared pure functions for TrialJourney state derivation.
 *
 * Extracted from trialController.js and trialAttendance.js so both callers
 * stay in sync — a single source of truth for the state machine.
 *
 * These functions are intentionally stateless: they accept a plain journey
 * object (Sequelize instance or plain JS object) and return a value.
 */

'use strict';

/**
 * Derive the current state label from a journey's timestamps.
 * Evaluated from most-advanced to least-advanced — first truthy wins.
 *
 * @param {object} journey
 * @returns {string}
 */
function computeState(journey) {
  if (journey.convertedAt)    return 'converted';
  if (journey.day3AttendedAt) return 'day3_attended';
  if (journey.day3BookedAt)   return 'day3_booked';
  if (journey.day2AttendedAt) return 'day2_attended';
  if (journey.day2BookedAt)   return 'day2_booked';
  if (journey.day1AttendedAt) return 'day1_attended';
  if (journey.day1BookedAt)   return 'day1_booked';
  if (journey.startedAt)      return 'trial_started';
  if (journey.tokenValidatedAt) return 'token_validated';
  return 'trial_started';
}

/**
 * Return the next day the user may book (1, 2, or 3), or null if they
 * must attend the currently-booked day first.
 *
 * Rules:
 *   - Day N can only be booked after day N-1 has been attended.
 *   - If all 3 days are booked (and attended), returns null.
 *
 * @param {object} journey
 * @returns {1|2|3|null}
 */
function computeNextBookableDay(journey) {
  if (!journey.day1BookedAt)                           return 1;
  if (journey.day1BookedAt && !journey.day1AttendedAt) return null;
  if (!journey.day2BookedAt)                           return 2;
  if (journey.day2BookedAt && !journey.day2AttendedAt) return null;
  if (!journey.day3BookedAt)                           return 3;
  return null;
}

/**
 * Return true if the 3-day trial window has passed.
 * startedAt must be a Date instance or parseable date string.
 *
 * @param {Date|string} startedAt
 * @returns {boolean}
 */
function isTrialExpired(startedAt) {
  if (!startedAt) return false;
  const end = new Date(new Date(startedAt).getTime() + 3 * 24 * 60 * 60 * 1000);
  return new Date() > end;
}

module.exports = { computeState, computeNextBookableDay, isTrialExpired };
