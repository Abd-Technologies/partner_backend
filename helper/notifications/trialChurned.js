/**
 * Channel: Trial churned — used free trial, didn't convert
 *
 * Segment: userType='User', status=false, usedFreeTrial=true, no paid UserPlan.
 *
 * ─── Why User.updatedAt as the day anchor ────────────────────────────────────
 * Free trial UserPlan rows are deleted when the trial expires
 * (AdminController ~line 2911: UserPlan.destroy()). There is no expireDate
 * left to query. User.updatedAt is set to the exact moment user.status is
 * flipped to false + user.save() fires — reliable as a "trial ended at" proxy.
 *
 * ─── Day sequence (from User.updatedAt) ──────────────────────────────────────
 *   Day 0-1   : Skip — too soon after trial ended.
 *   Day 2-7   : Hot window — data continuity hook.
 *   Day 8-14  : Habit is fading — social proof + momentum.
 *   Day 15-30 : Low pressure — data safety angle.
 *   Day 31-60 : Phase curiosity — strongest hook for cycle-aware users.
 *   Day 61+   : Stop permanently.
 *
 * Dedup: hasEverSent() per type — each bucket fires exactly once, ever.
 * Phase hooks appended when UserCycleData is set (trial users likely have it).
 */

const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { User } = require('../../models');
const sendNotification = require('../notification');
const { buildBody, getPhase, hasEverSent, getPaidPlanUserIds } = require('./_shared');

const DAY_BUCKETS = [
  {
    minDay: 2,
    maxDay: 7,
    type:   'trialChurnEarly',
    title:  'Your free trial just ended 🌱',
    body:   'Your cycle data is ready to keep working for you. Unlock the full plan and keep going.',
    screen: 'plans',
  },
  {
    minDay: 8,
    maxDay: 14,
    type:   'trialChurnMomentum',
    title:  "Don't stop here ⚡",
    body:   'You built something real during your trial. Thousands of women go further — keep going.',
    screen: 'plans',
  },
  {
    minDay: 15,
    maxDay: 30,
    type:   'trialChurnMid',
    title:  'Your data is still safe 💙',
    body:   "Everything you set up — your cycle, your progress — is still here. Come back whenever you're ready.",
    screen: 'home',
  },
  {
    minDay: 31,
    maxDay: 60,
    type:   'trialChurnLate',
    title:  'We saved your cycle plan 🌙',
    body:   "You were on to something. Come back and see what this month's phase looks like for you.",
    screen: 'home',
  },
];

function getBucket(daysSince) {
  return DAY_BUCKETS.find(
    (b) => daysSince >= b.minDay && daysSince <= b.maxDay
  ) || null;
}

async function sendTrialChurnedNudges() {
  try {
    const paidPlanUserIds = await getPaidPlanUserIds();

    const users = await User.findAll({
      where: {
        userType:      'User',
        status:        false,
        usedFreeTrial: true,
        deviceToken:   { [Op.ne]: null },
      },
      attributes: ['id', 'deviceToken', 'updatedAt'],
    });

    const results = { sent: 0, skippedPaid: 0, skippedWindow: 0, skippedDedup: 0 };

    for (const user of users) {
      if (paidPlanUserIds.has(user.id)) { results.skippedPaid++;   continue; }

      // updatedAt = when user.status → false was saved (= trial expiry proxy).
      const daysSince = moment().diff(moment(user.updatedAt), 'days');
      const bucket    = getBucket(daysSince);
      if (!bucket)                       { results.skippedWindow++; continue; }

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
      `[trial-churned] sent: ${results.sent} | paid: ${results.skippedPaid} | window: ${results.skippedWindow} | dedup: ${results.skippedDedup}`
    );
  } catch (err) {
    console.error('[trial-churned] Failed:', err);
  }
}

module.exports = { sendTrialChurnedNudges };
