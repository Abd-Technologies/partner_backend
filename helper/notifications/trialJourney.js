/**
 * Channel: TrialJourney — 3-day trial in progress (not yet converted)
 *
 * Segment: users with a TrialJourneys row, convertedAt=null, no paid UserPlan,
 *          AND whose 3-day window is still open (startedAt + 3 days > now).
 *
 * ─── Why this is separate from trialChurned.js ───────────────────────────────
 * The TrialJourney system (trialController.js) DOES NOT set usedFreeTrial=1.
 * trialChurned.js targets admin-assigned free trial users (usedFreeTrial=true).
 * These two systems are independent — their users never overlap.
 *
 * ─── Why this is separate from trialJourneyChurned.js ────────────────────────
 * This file only sends nudges while the trial window is still open (the user
 * can still act). Once startedAt + 3 days has passed, this channel stops.
 * trialJourneyChurned.js picks up users whose trial has expired and who
 * completed day 3 but never converted (highest-intent segment).
 *
 * ─── State machine ───────────────────────────────────────────────────────────
 * The TrialJourney model tracks progress via timestamps:
 *   startedAt          → trial opened, no day booked yet
 *   day1AttendedAt     → attended day 1, day 2 not yet booked
 *   day2AttendedAt     → attended day 2, day 3 not yet booked
 *   day3AttendedAt     → all 3 days done, not yet converted
 *
 * Nudge logic: match the current "stuck" state → send the matching message.
 * Cooldown prevents repeat sends. Max window prevents nudging after too long.
 *
 * ─── Cooldown strategy ───────────────────────────────────────────────────────
 * recentlySent() per type with N-day window.
 * Unlike lifecycle/churn buckets (hasEverSent), these CAN repeat — the user
 * could still act. They stop repeating only when the maxDays window expires.
 *
 * ─── maxDays constraints ─────────────────────────────────────────────────────
 * trialJourneyStart maxDays=3: trial expires 3 days after startedAt. Nudging
 *   beyond that sends a broken CTA ("Day 1 takes one tap") when bookDay would
 *   return 400 "Trial expired". Capped at 3 so the message is always actionable.
 *
 * trialJourneyDay2 / Day3 maxDays=2: anchored on attendedAt, not startedAt.
 *   The trial window closes at startedAt+3 regardless of when day1 was attended.
 *   maxDays=2 is conservative — the loop also checks trial-expiry explicitly
 *   (Bug B fix) so any over-run is caught there too.
 *
 * trialJourneyConvert: trial window is already closed (day3 attended). The
 *   convert endpoint has a 30-day grace window so maxDays=14 is fine here.
 *   But the loop's trial-expiry check is skipped for this segment because the
 *   CTA (convert → pick a plan) is still valid after the 3-day window closes.
 */

const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { TrialJourney, User } = require('../../models');
const sendNotification = require('../notification');
const { buildBody, getPhase, recentlySent, getPaidPlanUserIds } = require('./_shared');

// Trial length, class goal and join window all come from .env (see
// helper/trialState.js). Segments are based on how many classes she has
// attended (any class counts, no booking), not the old Day 1/2/3 ladder.
const { getTrialDays, getTrialClassGoal, getJoinWindowMinutes } = require('../trialState');
const { countTrialClassesAttended } = require('../trialClasses');

// ─── State segments ───────────────────────────────────────────────────────────
// Evaluated in order, first match wins. j._attended / j._goal are filled
// in by the loop below. Type names are kept from the old ladder so
// notification preferences and cooldown history still line up.

const STATE_SEGMENTS = [
  {
    type:          'trialJourneyStart',
    match:         (j) => !!j.startedAt && j._attended === 0,
    anchor:        (j) => j.startedAt,
    minStaleDays:  1,
    maxDays:       () => getTrialDays(),
    cooldownDays:  1,
    respectExpiry: true,
    title:         () => 'Your first class is waiting 🏃‍♀️',
    body:          () => `Join any live class today, in the first ${getJoinWindowMinutes()} minutes. No booking needed.`,
    screen:        'trial',
  },
  {
    type:          'trialJourneyDay2',
    match:         (j) => j._attended > 0 && j._attended < j._goal - 1,
    anchor:        (j) => j.startedAt,
    minStaleDays:  1,
    maxDays:       () => getTrialDays(),
    cooldownDays:  1,
    respectExpiry: true,
    title:         (j) => `${j._attended} of ${j._goal} classes done ✅`,
    body:          () => 'You showed up, and that takes discipline. Keep going, join any class today.',
    screen:        'trial',
  },
  {
    type:          'trialJourneyDay3',
    match:         (j) => j._goal > 1 && j._attended === j._goal - 1,
    anchor:        (j) => j.startedAt,
    minStaleDays:  1,
    maxDays:       () => getTrialDays(),
    cooldownDays:  1,
    respectExpiry: true,
    title:         () => 'One class left 🔥',
    body:          () => "You're one class away from your trial goal. Finish strong today.",
    screen:        'trial',
  },
  {
    type:          'trialJourneyConvert',
    match:         (j) => j._attended >= j._goal && !j.convertedAt,
    anchor:        (j) => j.startedAt,
    minStaleDays:  1,
    maxDays:       () => getTrialDays() + 14,
    cooldownDays:  2,
    respectExpiry: false, // convert endpoint has a 30-day grace window
    title:         () => 'You completed your trial goal 🌟',
    body:          (j) => `All ${j._goal} classes done. Keep the momentum going and join Fit Her.`,
    screen:        'plans',
  },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

function isTrialWindowClosed(startedAt) {
  if (!startedAt) return false;
  const end = new Date(new Date(startedAt).getTime() + getTrialDays() * 24 * 60 * 60 * 1000);
  return new Date() > end;
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function sendTrialJourneyNudges() {
  try {
    const paidPlanUserIds = await getPaidPlanUserIds();

    // Fetch all active (not yet converted) journeys with the linked user.
    // Only users with a deviceToken can receive push notifications.
    const journeys = await TrialJourney.findAll({
      where: { convertedAt: null },
      include: [{
        model:    User,
        as:       'user',
        required: true,
        where:    {
          userType:    'User',
          deviceToken: { [Op.ne]: null },
        },
        attributes: ['id', 'deviceToken'],
      }],
      attributes: [
        'userId',
        'startedAt',
        'day1BookedAt', 'day1AttendedAt',
        'day2BookedAt', 'day2AttendedAt',
        'day3BookedAt', 'day3AttendedAt',
        'convertedAt',
        'classGoal',
      ],
    });

    const results = {
      sent: 0,
      skippedPaid: 0,
      skippedExpired: 0,
      skippedWindow: 0,
      skippedCooldown: 0,
    };

    for (const journey of journeys) {
      const user = journey.user;
      if (!user) continue;

      // Lifecycle channel owns paid-plan users — skip them here.
      if (paidPlanUserIds.has(user.id)) { results.skippedPaid++; continue; }

      journey._attended = await countTrialClassesAttended(user.id, journey);
      journey._goal = getTrialClassGoal() /* always the current rule, even for trials that saved an older goal */;

      // Find the first segment this journey is in.
      const seg = STATE_SEGMENTS.find((s) => s.match(journey));
      if (!seg) continue; // booked-but-not-attended intermediate state

      // Bug B fix: skip if the 3-day trial window is closed AND this segment's
      // CTA requires the window to be open (respectExpiry=true). Sending
      // "Book Day 2" after the trial expired is misleading — the bookDay
      // endpoint will reject it.
      if (seg.respectExpiry && isTrialWindowClosed(journey.startedAt)) {
        results.skippedExpired++;
        continue;
      }

      const anchor    = seg.anchor(journey);
      const daysSince = moment().diff(moment(anchor), 'days');

      // Too fresh or too old — skip.
      if (daysSince < seg.minStaleDays || daysSince > seg.maxDays()) {
        results.skippedWindow++;
        continue;
      }

      if (await recentlySent(user.id, seg.type, seg.cooldownDays)) {
        results.skippedCooldown++;
        continue;
      }

      const phase = await getPhase(user.id);
      await sendNotification(
        [user.deviceToken],
        { title: seg.title(journey), body: buildBody(seg.body(journey), phase) },
        { type: seg.type, screen: seg.screen },
      );
      results.sent++;
    }

    console.log(
      `[trial-journey] sent: ${results.sent} | paid: ${results.skippedPaid} | ` +
      `expired: ${results.skippedExpired} | window: ${results.skippedWindow} | ` +
      `cooldown: ${results.skippedCooldown}`
    );
  } catch (err) {
    console.error('[trial-journey] Failed:', err);
  }
}

module.exports = { sendTrialJourneyNudges };
