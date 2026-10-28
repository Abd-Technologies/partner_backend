// Real attendance (Oct 2026): a day counts when she was in class for
// 10+ minutes that day (ClassPresence join/leave), not when Zoom opened.
// Days before the switch keep the old ClassAttendance marks so nobody's
// history disappears.
//
// Streak = attended class days in a row. Days with no classes on the
// schedule are skipped (they don't break it), and TODAY only counts once
// she has attended, so the streak no longer shows 0 before today's class.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { parseEndAsUtc } = require("./timeFormats");

const PKT = "Asia/Karachi";
const ATTENDED_SECONDS = 10 * 60;
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

async function motivationStats(userId) {
  const attended = await attendedDays(userId, 30);
  const weekdays = await classWeekdays();
  const today = moment.tz(PKT).startOf("day");
  const isClassDay = (d) => !weekdays || weekdays.has(d.format("dddd"));

  // Streak
  let streak = 0;
  const cursor = today.clone();
  if (!attended.has(cursor.format("YYYY-MM-DD"))) cursor.subtract(1, "day"); // today not attended yet: don't break
  for (let i = 0; i < 60; i++) {
    const key = cursor.format("YYYY-MM-DD");
    if (attended.has(key)) streak++;
    else if (isClassDay(cursor)) break;
    cursor.subtract(1, "day");
  }

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

module.exports = { attendedDays, motivationStats, ATTENDED_SECONDS };
