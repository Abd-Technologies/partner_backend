/**
 * Channel: Lifecycle — paid plan churned
 *
 * Two sub-segments, both userType='User', status=false, paid UserPlan history:
 *
 *   Mid-package  — plan expireDate > today (account deactivated while active).
 *                  Three urgency tiers unlock as daysLeft decreases.
 *
 *   Post-package — most recent paid plan expired 1–90 days ago.
 *                  Five time buckets fire in sequence as daysSince grows.
 *
 * Dedup: hasEverSent() per type — each tier/bucket fires exactly ONCE, ever.
 * Phase hooks appended when UserCycleData is set.
 * Runs daily at 10:00 PKT.
 */

const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { User, UserPlan, Plan } = require('../../models');
const sendNotification = require('../notification');
const { buildBody, getPhase, hasEverSent } = require('./_shared');

// ─── Mid-package urgency tiers ────────────────────────────────────────────────
// Dynamic title/body functions receive daysLeft at runtime.

const MID_PACKAGE_TIERS = [
  {
    minDaysLeft: 30,
    maxDaysLeft: Infinity,
    type:  'midPackageComfort',
    title: (d) => 'Your plan is still running ⏳',
    body:  (d) => `You still have ${d} days left on your package. Come back and make the most of them.`,
  },
  {
    minDaysLeft: 8,
    maxDaysLeft: 29,
    type:  'midPackageModerate',
    title: (d) => `Your plan has ${d} days left 📅`,
    body:  ()  => "Don't let your package go to waste. Pick up where you left off.",
  },
  {
    minDaysLeft: 1,
    maxDaysLeft: 7,
    type:  'midPackageUrgent',
    title: (d) => `Expiring in ${d} day${d === 1 ? '' : 's'} ⚠️`,
    body:  (d) => `You invested in this — use it. Your package runs out in ${d} day${d === 1 ? '' : 's'}.`,
  },
];

// ─── Post-package time buckets ────────────────────────────────────────────────

const POST_PACKAGE_BUCKETS = [
  {
    minDay: 2,   maxDay: 7,
    type:   'postPackageEarly',
    title:  'You finished your program 🌟',
    body:   'Real work, real results. Ready to keep the momentum going with your next package?',
  },
  {
    minDay: 8,   maxDay: 14,
    type:   'postPackageKeep',
    title:  "Don't lose your momentum ⚡",
    body:   'It took weeks to build this habit. Keep it going with your next package.',
  },
  {
    minDay: 15,  maxDay: 30,
    type:   'postPackageMid',
    title:  "It's been a few weeks 🌿",
    body:   'Your body remembers the work you put in. Starting back is always easier than starting fresh.',
  },
  {
    minDay: 31,  maxDay: 45,
    type:   'postPackageDrift',
    title:  "We're still here for you 💙",
    body:   "Life gets busy — we get it. Your spot on Fit Her is still waiting.",
  },
  {
    minDay: 46,  maxDay: 90,
    type:   'postPackageLate',
    title:  'We miss you on Fit Her 🌙',
    body:   "Three months is a pause, not an ending. Your data is safe and your spot is here.",
  },
  // Day 91+: no bucket — stop permanently.
];

// ─── Paid-plan filter (shared with post-package query) ────────────────────────

const PAID_PLAN_WHERE = { title: { [Op.ne]: 'Free Trial' } };

// ─── Segment: mid-package ─────────────────────────────────────────────────────

async function sendMidPackageChurnNudges() {
  const users = await User.findAll({
    where: { userType: 'User', status: false, deviceToken: { [Op.ne]: null } },
    include: [{
      model:    UserPlan,
      required: true,
      where:    { expireDate: { [Op.gt]: new Date() } },
      include:  [{ model: Plan, required: true, where: PAID_PLAN_WHERE, attributes: ['id'] }],
      attributes: ['id', 'expireDate'],
    }],
    attributes: ['id', 'deviceToken'],
  });

  let sent = 0;
  for (const user of users) {
    const plan = (user.UserPlans || [])
      .sort((a, b) => new Date(b.expireDate) - new Date(a.expireDate))[0];
    if (!plan) continue;

    const daysLeft = moment(plan.expireDate).diff(moment(), 'days');
    if (daysLeft < 1) continue;

    const tier = MID_PACKAGE_TIERS.find(
      (t) => daysLeft >= t.minDaysLeft && daysLeft <= t.maxDaysLeft
    );
    if (!tier) continue;
    if (await hasEverSent(user.id, tier.type)) continue;

    const phase = await getPhase(user.id);
    await sendNotification(
      [user.deviceToken],
      { title: tier.title(daysLeft), body: buildBody(tier.body(daysLeft), phase) },
      { type: tier.type },
    );
    sent++;
  }
  return sent;
}

// ─── Segment: post-package ────────────────────────────────────────────────────

async function sendPostPackageChurnNudges() {
  const ninetyDaysAgo = moment().subtract(90, 'days').toDate();

  const users = await User.findAll({
    where: { userType: 'User', status: false, deviceToken: { [Op.ne]: null } },
    include: [{
      model:    UserPlan,
      required: true,
      where:    { expireDate: { [Op.lt]: new Date(), [Op.gte]: ninetyDaysAgo } },
      include:  [{ model: Plan, required: true, where: PAID_PLAN_WHERE, attributes: ['id'] }],
      attributes: ['id', 'expireDate'],
    }],
    attributes: ['id', 'deviceToken'],
  });

  let sent = 0;
  for (const user of users) {
    const latestPlan = (user.UserPlans || [])
      .sort((a, b) => new Date(b.expireDate) - new Date(a.expireDate))[0];
    if (!latestPlan) continue;

    const daysSince = moment().diff(moment(latestPlan.expireDate), 'days');
    const bucket = POST_PACKAGE_BUCKETS.find(
      (b) => daysSince >= b.minDay && daysSince <= b.maxDay
    );
    if (!bucket) continue;
    if (await hasEverSent(user.id, bucket.type)) continue;

    const phase = await getPhase(user.id);
    await sendNotification(
      [user.deviceToken],
      { title: bucket.title, body: buildBody(bucket.body, phase) },
      { type: bucket.type },
    );
    sent++;
  }
  return sent;
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function sendLifecycleNudges() {
  try {
    const mid  = await sendMidPackageChurnNudges();
    const post = await sendPostPackageChurnNudges();
    console.log(`[lifecycle] mid-package: ${mid} | post-package: ${post}`);
  } catch (err) {
    console.error('[lifecycle] Failed:', err);
  }
}

module.exports = { sendLifecycleNudges };
