/**
 * Channel: Luna daily, 8 PM in HER time zone (Nov 2026).
 *
 * One push a day from Luna asking her to log today's insights (feeling,
 * water, sleep). Tap opens Home and scrolls to the "Today's insights" box
 * (app: type 'lunaDaily'). Older apps just open the app.
 *
 * Who: clients with the app installed who have the paid home, i.e.
 *   - a running paid plan, or
 *   - a free trial that is still running.
 * Sent every day, logged or not. The text changes when she already logged.
 *
 * Runs every 5 minutes. A woman is picked up in the 5 minute run that
 * contains 20:00 her time. A redis claim per local day makes it once a day
 * even if runs overlap or the server restarts.
 */
const { Op } = require('sequelize');
const moment = require('moment-timezone');
const Redis = require('ioredis');
const { User, UserPlan, Plan, TrialJourney, DailyCheckin, WaterLog } = require('../../models');
const sendNotification = require('../notification');

const redis = new Redis();
const SEND_HOUR = Number(process.env.LUNA_DAILY_HOUR || 20);
const WINDOW_MIN = 5; // cron every 5 min
const DEFAULT_TZ = 'Asia/Karachi';

const PAID_PLAN_WHERE = {
  [Op.and]: [
    { title: { [Op.ne]: 'Free Trial' } },
    { title: { [Op.notLike]: 'system%' } },
    { title: { [Op.notLike]: '%trial%' } },
  ],
};

function trialDays() {
  try { return require('../trialState').getTrialDays(); } catch (_) { return 3; }
}

/** userIds with a running paid plan or a running free trial. */
async function audienceIds() {
  const ids = new Set();
  const paid = await UserPlan.findAll({
    where: { expireDate: { [Op.gt]: new Date() }, isTrial: { [Op.not]: true } },
    include: [{ model: Plan, required: true, where: PAID_PLAN_WHERE, attributes: ['id'] }],
    attributes: ['userId'],
  });
  paid.forEach((p) => ids.add(p.userId));

  const since = moment().subtract(trialDays(), 'days').toDate();
  const trials = await TrialJourney.findAll({
    where: { convertedAt: null, startedAt: { [Op.gte]: since } },
    attributes: ['userId'],
  });
  trials.forEach((t) => ids.add(t.userId));
  return ids;
}

/** True when it is SEND_HOUR:00 to SEND_HOUR:04 her time. */
function isHerSendTime(tz) {
  const now = moment().tz(tz || DEFAULT_TZ);
  return now.hours() === SEND_HOUR && now.minutes() < WINDOW_MIN;
}

async function loggedToday(userId, day) {
  const [c, w] = await Promise.all([
    DailyCheckin.findOne({ where: { userId, date: day }, attributes: ['id'] }),
    WaterLog ? WaterLog.findOne({ where: { userId, date: day }, attributes: ['id'] }) : null,
  ]);
  return !!(c || w);
}

function message(name, logged) {
  const hi = name ? `${name}, ` : '';
  if (logged) {
    return {
      title: 'Luna 🌙 Nice work today',
      body: `${hi}you checked in today. Open Fit Her to finish anything left and see today's tip.`,
    };
  }
  return {
    title: 'Luna 🌙 How was your day?',
    body: `${hi}log your feeling, water and sleep. It takes 10 seconds and helps me learn your body.`,
  };
}

async function sendLunaDailyNudges() {
  let sent = 0;
  try {
    const ids = await audienceIds();
    if (!ids.size) return 0;
    const users = await User.findAll({
      where: { id: { [Op.in]: [...ids] }, userType: 'User', deviceToken: { [Op.ne]: null } },
      attributes: ['id', 'firstName', 'deviceToken', 'timeZone'],
    });
    for (const u of users) {
      const tz = u.timeZone || DEFAULT_TZ;
      if (!isHerSendTime(tz)) continue;
      const day = moment().tz(tz).format('YYYY-MM-DD');
      try {
        const ok = await redis.set(`luna:daily:${u.id}:${day}`, '1', 'EX', 2 * 24 * 3600, 'NX');
        if (!ok) continue; // already sent today
      } catch (_) { /* redis down: send anyway */ }
      const logged = await loggedToday(u.id, day);
      const name = (u.firstName || '').trim().split(/\s+/)[0] || '';
      await sendNotification([u.deviceToken], message(name, logged), {
        type: 'lunaDaily',
        screen: 'home',
        target: 'insights',
      });
      sent++;
    }
    if (sent) console.log(`[luna-daily] sent ${sent}`);
  } catch (err) {
    console.error('[luna-daily] failed:', err);
  }
  return sent;
}

module.exports = { sendLunaDailyNudges };
