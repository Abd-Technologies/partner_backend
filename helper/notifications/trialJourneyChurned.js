/**
 * Channel: TrialJourneyChurned — completed 3-day trial, never converted
 *
 * Segment: TrialJourney rows where:
 *   - day3AttendedAt IS NOT NULL   (completed all 3 days)
 *   - convertedAt IS NULL          (never bought a paid plan)
 *   - no active paid UserPlan
 *
 * ─── Why this channel exists ─────────────────────────────────────────────────
 * This is the highest-intent segment in the entire funnel. These users:
 *   1. Chose to start a trial (explicit opt-in after Bug 1 fix)
 *   2. Attended 3 classes (10+ minutes each)
 *   3. Did NOT convert
 *
 * trialJourney.js covers them while their trial is live (trialJourneyConvert,
 * up to 14 days after day3AttendedAt). Once that window closes, every other
 * channel excludes them:
 *   - downloaded.js    excludes all TrialJourney users (getTrialJourneyUserIds)
 *   - trialChurned.js  only targets usedFreeTrial=true (old admin system)
 *   - lifecycle.js     only targets paid UserPlan holders
 *
 * This channel fills that gap with a focused 4-bucket re-engagement sequence.
 *
 * ─── Overlap avoidance ───────────────────────────────────────────────────────
 * trialJourney.js (trialJourneyConvert segment) fires for the first 14 days
 * after day3AttendedAt. This channel's earliest bucket starts at day 15 so
 * the two channels never fire on the same user on the same day.
 *
 * ─── Day sequence (from day3AttendedAt) ──────────────────────────────────────
 *   Day 0-14  : Owned by trialJourney.js (trialJourneyConvert segment).
 *   Day 15-21 : This channel starts — "you finished, plans are ready".
 *   Day 22-35 : Momentum / habit hook.
 *   Day 36-55 : Low-pressure, data-safety angle.
 *   Day 56-90 : Final winback, cycle-phase hook.
 *   Day 91+   : Stop permanently.
 *
 * Dedup: hasEverSent() per type — each bucket fires exactly once, ever.
 * Phase hooks appended when UserCycleData is set.
 * Runs daily at 09:15 PKT (5-minute offset from trialJourney at 09:10).
 */

'use strict';

const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { TrialJourney, User } = require('../../models');
const sendNotification = require('../notification');
const { buildBody, getPhase, hasEverSent, getPaidPlanUserIds } = require('./_shared');

// ─── Re-engagement buckets ───────────────────────────────────────────────────
// Anchor: day3AttendedAt
// These fire after trialJourney.js's convert nudge window (14 days) has closed.

const DAY_BUCKETS = [
  {
    minDay: 15,
    maxDay: 21,
    type:   'trialJourneyChurnEarly',
    title:  'Your trial is complete 🌟',
    body:   "You attended all 3 classes — that's real commitment. Your full Fit Her plan is ready whenever you are.",
    screen: 'plans',
  },
  {
    minDay: 22,
    maxDay: 35,
    type:   'trialJourneyChurnMomentum',
    title:  "Don't lose what you built ⚡",
    body:   "You showed up 3 times. The hardest part is behind you — keep the habit going with a full plan.",
    screen: 'plans',
  },
  {
    minDay: 36,
    maxDay: 55,
    type:   'trialJourneyChurnMid',
    title:  'Your progress is still here 💙',
    body:   "Everything you set up — your cycle, your classes — is still waiting. Come back whenever you're ready.",
    screen: 'home',
  },
  {
    minDay: 56,
    maxDay: 90,
    type:   'trialJourneyChurnLate',
    title:  'We saved your cycle plan 🌙',
    body:   "You were on to something real. Come back and see what this month's phase looks like for you.",
    screen: 'home',
  },
];

function getBucket(daysSince) {
  return DAY_BUCKETS.find((b) => daysSince >= b.minDay && daysSince <= b.maxDay) || null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function sendTrialJourneyChurnedNudges() {
  try {
    const paidPlanUserIds = await getPaidPlanUserIds();

    // Fetch completed-but-unconverted journeys with the linked user.
    const journeys = await TrialJourney.findAll({
      where: {
        day3AttendedAt: { [Op.ne]: null },
        convertedAt:    null,
      },
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
      attributes: ['userId', 'day3AttendedAt'],
    });

    const results = { sent: 0, skippedPaid: 0, skippedWindow: 0, skippedDedup: 0 };

    for (const journey of journeys) {
      const user = journey.user;
      if (!user) continue;

      // lifecycle.js owns paid-plan users — skip them here.
      if (paidPlanUserIds.has(user.id)) { results.skippedPaid++; continue; }

      const daysSince = moment().diff(moment(journey.day3AttendedAt), 'days');
      const bucket    = getBucket(daysSince);
      if (!bucket) { results.skippedWindow++; continue; }

      // hasEverSent: each bucket fires exactly once per user, ever.
      if (await hasEverSent(user.id, bucket.type)) {
        results.skippedDedup++;
        continue;
      }

      const phase = await getPhase(user.id);
      await sendNotification(
        [user.deviceToken],
        { title: bucket.title, body: buildBody(bucket.body, phase) },
        { type: bucket.type, screen: bucket.screen },
      );
      results.sent++;
    }

    console.log(
      `[trial-journey-churned] sent: ${results.sent} | paid: ${results.skippedPaid} | ` +
      `window: ${results.skippedWindow} | dedup: ${results.skippedDedup}`
    );
  } catch (err) {
    console.error('[trial-journey-churned] Failed:', err);
  }
}

module.exports = { sendTrialJourneyChurnedNudges };
