// Real attendance (Oct 2026): a day counts when she was in class for
// 10+ minutes that day (ClassPresence join/leave), not when Zoom opened.
// Days before the switch keep the old ClassAttendance marks so nobody's
// history disappears.
//
// Streak = days she did something since she joined: a class, a meal,
// water or her daily insights; sign-up day counts (see streakDays).
// A missed day pauses it, never resets it to 0 (Nov 2026).
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { parseEndAsUtc } = require("./timeFormats");

const PKT = "Asia/Karachi";
const ATTENDED_SECONDS = require("./trialAttendance").minTrialAttendanceSeconds(); // 5 min (one rule)
const SWITCH_DAY = "2026-10-17"; // before this: legacy ClassAttendance marks

function endOnDay(slot, dayPkt) {
  const s = parseEndAsUtc(slot && slot.start, dayPkt);
  let e = parseEndAsUtc(slot && slot.end, dayPkt);
  if (!e) return null;
  const local = e.clone().tz(PKT);
  e = dayPkt.clone().startOf("day").hour(local.hour()).minute(local.minute()).utc();
  if (s) {
    const sl = s.clone().tz(PKT);
    const st = dayPkt.clone().startOf("day").hour(sl.hour()).minute(sl.minute()).utc();
    if (e.isSameOrBefore(st)) e.add(1, "day");
  }
  return e;
}

/** Set of "YYYY-MM-DD" (PKT) days she attended in the last [days] days. */
async function attendedDays(userId, days = 30) {
  const { ClassPresence, ClassAttendance, Slot } = require("../models");
  const from = moment.tz(PKT).startOf("day").subtract(days - 1, "days");
  const out = new Set();

  const rows = await ClassPresence.findAll({
    where: { userId, joinedAt: { [Op.gte]: from.toDate() } },
    include: [{ model: Slot, as: "slot", attributes: ["id", "start", "end"], paranoid: false }],
  });
  const perDay = new Map();
  const now = moment.utc();
  for (const p of rows) {
    const dayPkt = moment.tz(p.joinedAt, PKT).startOf("day");
    const key = dayPkt.format("YYYY-MM-DD");
    let secs = Number(p.durationSeconds) || 0;
    if (!p.leftAt) {
      // No "leave" (joined through the Zoom app, or the app was closed):
      // count her as there until the class ended.
      const end = endOnDay(p.slot, dayPkt);
      const until = end ? moment.min(end, now) : moment.utc(p.lastSeenAt || p.joinedAt);
      secs = Math.max(secs, until.diff(moment.utc(p.joinedAt), "seconds"));
    }
    perDay.set(key, (perDay.get(key) || 0) + Math.max(0, secs));
  }
  for (const [k, secs] of perDay) if (secs >= ATTENDED_SECONDS) out.add(k);

  // Legacy marks, only before the switch day.
  if (ClassAttendance) {
    const legacy = await ClassAttendance.findAll({
      where: { user_id: userId, attended_at: { [Op.gte]: from.format("YYYY-MM-DD"), [Op.lt]: SWITCH_DAY } },
      attributes: ["attended_at"],
    });
    for (const l of legacy) out.add(moment(l.attended_at).format("YYYY-MM-DD"));
  }
  return out;
}

/** Weekdays that have at least one class on the schedule ("Monday"…). */
async function classWeekdays() {
  try {
    const { Slot, Time } = require("../models");
    const slots = await Slot.findAll({
      where: { trainerId: { [Op.ne]: null } },
      include: [{ model: Time, attributes: ["day"] }],
      attributes: ["id"],
    });
    const set = new Set(slots.map((s) => s.Time && s.Time.day).filter(Boolean));
    return set.size ? set : null; // null = treat every day as a class day
  } catch (_) {
    return null;
  }
}

/**
 * Days (PKT "YYYY-MM-DD") she did ANYTHING for herself in the last [days]
 * days: logged a meal, water, or a daily check-in (mood / energy / sleep).
 * Class days come from attendedDays(). Used for the streak (Oct 2026).
 */
async function activityDays(userId, days = 60) {
  const M = require("../models");
  const from = moment.tz(PKT).startOf("day").subtract(days - 1, "days").format("YYYY-MM-DD");
  const out = new Set();
  const add = (d) => {
    if (!d) return;
    const key = moment(d).format("YYYY-MM-DD");
    if (key >= from) out.add(key);
  };
  const tries = [
    M.MealLog && M.MealLog.findAll({
      where: { userId, date: { [Op.gte]: from }, status: { [Op.ne]: "pending" } },
      attributes: ["date"], group: ["date"], raw: true,
    }),
    M.WaterLog && M.WaterLog.findAll({
      where: { userId, date: { [Op.gte]: from }, amountMl: { [Op.gt]: 0 } },
      attributes: ["date"], group: ["date"], raw: true,
    }),
    M.DailyCheckin && M.DailyCheckin.findAll({
      where: { userId, date: { [Op.gte]: from } },
      attributes: ["date"], group: ["date"], raw: true,
    }),
  ];
  for (const t of tries) {
    if (!t) continue;
    try {
      (await t).forEach((r) => add(r.date));
    } catch (e) {
      console.error("[attendanceStats] activityDays", e.message);
    }
  }
  return out;
}

/**
 * Streak (Nov 2026, founder's rule): how many days she has done something
 * for herself since she joined: a class (5+ min), a meal, water or her
 * daily insights. Her sign-up day counts, so a new member starts at 1.
 * A day with nothing does NOT reset it to 0: the number pauses and
 * carries on from there the next day she's active. It never goes down.
 * Used by Home and Profile (one rule).
 */
async function streakDays(userId) {
  const today = moment.tz(PKT).startOf("day");
  let signupDay = null;
  try {
    const u = await require("../models").User.findByPk(userId, { attributes: ["createdAt"], raw: true });
    if (u && u.createdAt) signupDay = moment(u.createdAt).tz(PKT).startOf("day");
  } catch (e) {
    console.error("[attendanceStats] signup day", e.message);
  }
  // Look back to her sign-up day (60 days if unknown; max ~3 years).
  const span = signupDay ? Math.min(1100, Math.max(1, today.diff(signupDay, "days") + 1)) : 60;
  const active = new Set([...(await attendedDays(userId, span)), ...(await activityDays(userId, span))]);
  if (signupDay) active.add(signupDay.format("YYYY-MM-DD"));
  const todayKey = today.format("YYYY-MM-DD");
  const fromKey = signupDay ? signupDay.format("YYYY-MM-DD") : null;
  return [...active].filter((d) => d <= todayKey && (!fromKey || d >= fromKey)).length;
}

async function motivationStats(userId) {
  const attended = await attendedDays(userId, 30);
  const weekdays = await classWeekdays();
  const today = moment.tz(PKT).startOf("day");
  const isClassDay = (d) => !weekdays || weekdays.has(d.format("dddd"));

  const streak = await streakDays(userId);

  // Counts + chart
  const history = [];
  let classDays30 = 0;
  let last7 = 0;
  for (let i = 29; i >= 0; i--) {
    const d = today.clone().subtract(i, "days");
    const key = d.format("YYYY-MM-DD");
    const was = attended.has(key);
    if (isClassDay(d)) classDays30++;
    if (was && i < 7) last7++;
    history.push({ date: key, attended: was ? 1 : 0 });
  }
  const last30 = attended.size;
  return {
    streak,
    daysAttendedLast7: last7,
    daysAttendedLast30: last30,
    regularityPercentage: classDays30 ? Math.min(100, Math.round((last30 / classDays30) * 100)) : 0,
    attendanceHistory: history,
  };
}

module.exports = { attendedDays, activityDays, streakDays, motivationStats, ATTENDED_SECONDS, endOnDay };
