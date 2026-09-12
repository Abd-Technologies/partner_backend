/**
 * Channel: Downloaded — never started any trial
 *
 * Segment: userType='User', status=false, usedFreeTrial=false,
 *          no TrialJourney row, no paid UserPlan.
 * Goal: get the user to tap "Start Free Trial" for the first time.
 *
 * Overlap prevention:
 * Users who started the 3-day TrialJourney flow (trialController.js) also have
 * usedFreeTrial=false, so we explicitly exclude them via getTrialJourneyUserIds().
 * They are handled by the trialJourney.js channel instead.
 *
 * Day sequence (from User.createdAt):
 *   Day 0-1   : Skip — too fresh.
 *   Day 2-6   : Curiosity hook.
 *   Day 7-13  : Week callback.
 *   Day 14-20 : Specificity + mild urgency.
 *   Day 21-30 : Final winback, no pressure.
 *   Day 31+   : Stop permanently.
 *
 * Dedup: recentlySent() with 7-day cooldown (type: downloadNudge).
 * At most 4 messages over 30 days — one per week bucket.
 */

const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { User } = require('../../models');
const sendNotification = require('../notification');
const { recentlySent, getPaidPlanUserIds, getTrialJourneyUserIds } = require('./_shared');

const DAY_BUCKETS = [
  {
    minDay: 2,
    maxDay: 6,
    title:  "See what's inside Fit Her ✨",
    body:   'Your free trial is ready — discover your cycle-powered fitness plan in 2 minutes.',
    screen: 'trial',
  },
  {
    minDay: 7,
    maxDay: 13,
    title:  "It's been a week 🌱",
    body:   'You joined Fit Her 7 days ago. Your personalised plan is still waiting — start your free trial today.',
    screen: 'trial',
  },
  {
    minDay: 14,
    maxDay: 20,
    title:  'Your cycle-powered plan is ready 💪',
    body:   "Thousands of women have found workouts that work with their cycle — not against it. Your free trial is here.",
    screen: 'trial',
  },
  {
    minDay: 21,
    maxDay: 30,
    title:  'One last nudge from us 💚',
    body:   "We won't keep asking — but your free trial is still here whenever you're ready.",
    screen: 'trial',
  },
];

function getBucket(daysSinceSignup) {
  return DAY_BUCKETS.find(
    (b) => daysSinceSignup >= b.minDay && daysSinceSignup <= b.maxDay
  ) || null;
}

async function sendDownloadedUserNudges() {
  try {
    const [paidPlanUserIds, trialJourneyUserIds] = await Promise.all([
      getPaidPlanUserIds(),
      getTrialJourneyUserIds(),
    ]);

    const users = await User.findAll({
      where: {
        userType:      'User',
        status:        false,
        usedFreeTrial: false,
        deviceToken:   { [Op.ne]: null },
      },
      attributes: ['id', 'deviceToken', 'createdAt'],
    });

    const results = { sent: 0, skippedPaid: 0, skippedTrial: 0, skippedWindow: 0, skippedCooldown: 0 };

    for (const user of users) {
      if (paidPlanUserIds.has(user.id))     { results.skippedPaid++;     continue; }
      if (trialJourneyUserIds.has(user.id)) { results.skippedTrial++;    continue; }

      const daysSince = moment().diff(moment(user.createdAt), 'days');
      const bucket    = getBucket(daysSince);
      if (!bucket)                          { results.skippedWindow++;   continue; }

      if (await recentlySent(user.id, 'downloadNudge', 7)) {
        results.skippedCooldown++;
        continue;
      }

      await sendNotification(
        [user.deviceToken],
        { title: bucket.title, body: bucket.body },
        { type: 'downloadNudge', screen: bucket.screen },
      );
      results.sent++;
    }

    console.log(
      `[downloaded] sent: ${results.sent} | paid: ${results.skippedPaid} | trial: ${results.skippedTrial} | window: ${results.skippedWindow} | cooldown: ${results.skippedCooldown}`
    );
  } catch (err) {
    console.error('[downloaded] Failed:', err);
  }
}

module.exports = { sendDownloadedUserNudges };
