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
const { User, WeeklyCheckin } = require('../../models');
const sendNotification = require('../notification');
const { buildBody, getPhase, recentlySent } = require('./_shared');

async function sendWeeklyCheckinReminders() {
  try {
    // ISO week starts on Monday — format as YYYY-MM-DD for string comparison
    // against WeeklyCheckin.weekDate (which is also stored as YYYY-MM-DD string).
    const weekStart = moment().startOf('isoWeek').format('YYYY-MM-DD');

    // Users who already submitted a check-in this week — no point nudging them.
    const submitted = await WeeklyCheckin.findAll({
      where:      { weekDate: { [Op.gte]: weekStart } },
      attributes: ['userId'],
    });
    const submittedUserIds = new Set(submitted.map((r) => r.userId));

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
      if (submittedUserIds.has(user.id)) { results.skippedSubmitted++; continue; }

      // Prevent double-fire within 6 days
      if (await recentlySent(user.id, 'weeklyCheckin', 6)) { results.skippedCooldown++; continue; }

      const phase = await getPhase(user.id);
      await sendNotification(
        [user.deviceToken],
        {
          title: 'Weekly check-in time 📊',
          body:  buildBody(
            'How did your week go? Log your weight, measurements, and weekly rating before the week closes.',
            phase
          ),
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
