/**
 * Channel: Weekly check-in reminder
 *
 * Fires: Sunday 19:00 PKT (cron: '0 19 * * 0').
 * Target: active users (status=true, userType='User') with a deviceToken.
 * Skip: users who already submitted a WeeklyCheckin this ISO week (Mon–Sun).
 * Pref: NotificationPreference.weeklyCheckin (independent toggle from morningNudge).
 * Dedup: recentlySent() with 6-day cooldown — prevents double-fire if the cron
 *        somehow runs twice in the same week.
 *
 * ─── Message strategy ────────────────────────────────────────────────────────
 * Simple, low-pressure prompt to log weight/measurements/weekly rating.
 * Phase hook appended when UserCycleData is set — makes it feel personal
 * ("It's your follicular week — a great time to notice how you felt").
 *
 * ─── Why active users only ───────────────────────────────────────────────────
 * Churned users (status=false) are handled by downloaded / trialChurned /
 * lifecycle channels. The weekly check-in is a retention/engagement tool
 * for users currently on a plan, not a win-back message.
 */

const { Op } = require('sequelize');
const moment = require('moment-timezone');
const { User, WeeklyCheckin, UserPlan } = require('../../models');
const sendNotification = require('../notification');
const { buildBody, getPhase, recentlySent } = require('./_shared');
const { stateFor } = require('../weeklyCheckin');

// Same words as the Home card (one weekly check-in, Oct 2026).
const COPY = {
  week1: {
    title: 'How was your first week? 📊',
    body: 'Your week 1 check-in is ready. Your dietitian uses it to tune your plan.',
  },
  halfway: {
    title: 'Halfway there! ⭐',
    body: 'Share your progress to unlock your follow-up call.',
  },
  end: {
    title: 'Your end-of-plan check-in 🌿',
    body: "See how far you've come and plan what's next.",
  },
  weekly: {
    title: 'Weekly check-in time 📊',
    body: 'How did your week go? Log your weight, measurements, and weekly rating before the week closes.',
  },
};

async function sendWeeklyCheckinReminders() {
  try {
    // ISO week starts on Monday — format as YYYY-MM-DD for string comparison
    // against WeeklyCheckin.weekDate (which is also stored as YYYY-MM-DD string).
    const weekStart = moment().startOf('isoWeek').format('YYYY-MM-DD');

    // Users who already submitted a check-in this week — no point nudging them.
    const submitted = await WeeklyCheckin.findAll({
      // Only real check-ins count (Oct 2026). A weight logged from the
      // Home tile also saves a row for the week, which wrongly silenced
      // her check-in reminder. stateFor() below makes the final call.
      where:      { weekDate: { [Op.gte]: weekStart }, checkinDay: { [Op.ne]: null } },
      attributes: ['userId'],
    });
    const submittedUserIds = new Set(submitted.map((r) => r.userId));

    // Only paid women, from 7 days after their paid plan began (same rule
    // as the app's Weekly check-in card). Never during the free trial.
    const weekAgo = moment().subtract(7, 'days').toDate();
    const paidPlans = await UserPlan.findAll({
      where: {
        status: true,
        isTrial: { [Op.not]: true },
        cancelledAt: null,
        expireDate: { [Op.gte]: new Date() },
        buyingDate: { [Op.lte]: weekAgo },
      },
      attributes: ['userId'],
    });
    const eligible = new Set(paidPlans.map((p) => p.userId));
    const users = await User.findAll({
      where: {
        userType:    'User',
        status:      true,
        deviceToken: { [Op.ne]: null },
      },
      attributes: ['id', 'deviceToken'],
    });

    const results = { sent: 0, skippedSubmitted: 0, skippedCooldown: 0 };

    for (const user of users) {
      // Already checked in this week — skip
      if (!eligible.has(user.id)) continue;
      if (submittedUserIds.has(user.id)) { results.skippedSubmitted++; continue; }

      // Prevent double-fire within 6 days
      if (await recentlySent(user.id, 'weeklyCheckin', 6)) { results.skippedCooldown++; continue; }

      // Her own check-in week (7 days from her diet plan / plan start).
      const state = await stateFor(user.id);
      if (!state.due) { results.skippedSubmitted++; continue; }
      const copy = COPY[state.label] || COPY.weekly;

      const phase = await getPhase(user.id);
      await sendNotification(
        [user.deviceToken],
        {
          title: copy.title,
          body:  buildBody(copy.body, phase),
        },
        { type: 'weeklyCheckin', screen: 'checkin' },
      );
      results.sent++;
    }

    console.log(
      `[weekly-checkin] sent: ${results.sent} | submitted: ${results.skippedSubmitted} | cooldown: ${results.skippedCooldown}`
    );
  } catch (err) {
    console.error('[weekly-checkin] Failed:', err);
  }
}

module.exports = { sendWeeklyCheckinReminders };
