// Missed Session nudge — paid workout / combined clients only (free-trial
// users already get their own 9:10 AM journey nudges).
//
// Rule (Oct 2026):
//   • Look at HER classes for the day (her picked times, or every class if
//     she picked none — helper/classAudience.js), ignoring cancelled ones.
//   • If she joined no class at all that day, send ONE push
//     30 min after her last class ends — same evening.
//   • If that moment falls inside her quiet hours (e.g. 10 PM class →
//     11:30 PM), send it the next morning instead, once quiet hours end
//     (9 AM – 12 noon her time), pointing to today's class.
//   • Once per class day. If all her classes were cancelled, nothing.
//
// Before: it waited for the LAST class of the whole day (10 PM) + 30 min,
// which is always inside quiet hours, so it was never delivered.
const moment = require("moment-timezone");
const Redis = require("ioredis");
const { Op } = require("sequelize");
const { ClassAttendance, ClassPresence, Slot, Time } = require("../models");
const sendNotification = require("./notification");
const { isInQuietHours } = require("./notification");
const { getClassUsers, isHerClass } = require("./classAudience");
const { parseEndAsUtc } = require("./timeFormats");

const redis = new Redis();
const PKT = "Asia/Karachi";
const AFTER_MIN = 30; // minutes after her last class ends
const EVENING_WINDOW_H = 3; // same-evening send must happen within 3 h
const MORNING_FROM_HOUR = 9; // morning fallback from 9 AM…
const MORNING_CUTOFF_HOUR = 12; // …until noon (her time)

const sentKey = (userId, day) => `missedRecovery:${userId}:${day}`;
async function wasSent(userId, day) {
  return !!(await redis.get(sentKey(userId, day)));
}
async function markSent(userId, day) {
  await redis.set(sentKey(userId, day), "1", "EX", 60 * 60 * 60);
}

/** Classes of one PKT day with real start/end instants. */
async function classesOn(dayPkt) {
  const slots = await Slot.findAll({
    attributes: ["id", "start", "end", "type", "description", "status", "trainerId"],
    where: { trainerId: { [Op.ne]: null } },
    include: [{ model: Time, attributes: ["day"], where: { day: dayPkt.format("dddd") } }],
  });
  return slots
    .map((s) => ({ s, startUtc: parseEndAsUtc(s.start, dayPkt), endUtc: parseEndAsUtc(s.end, dayPkt) }))
    .filter((x) => x.startUtc && x.endUtc)
    .map((x) => {
      if (x.endUtc.isSameOrBefore(x.startUtc)) x.endUtc.add(1, "day");
      return x;
    });
}

/** Did she join any class on this PKT day? */
async function attendedOn(userId, dayPkt) {
  const from = dayPkt.clone().startOf("day").toDate();
  const to = dayPkt.clone().endOf("day").toDate();
  const presence = await ClassPresence.count({ where: { userId, joinedAt: { [Op.between]: [from, to] } } });
  if (presence) return true;
  const marked = await ClassAttendance.count({ where: { user_id: userId, createdAt: { [Op.between]: [from, to] } } });
  return marked > 0;
}

const label = (x, tz) => {
  const t = x.startUtc.clone().tz(tz || PKT).format("h:mm A");
  const type = (x.s.type || x.s.description || "class").trim();
  return `${t} ${type}`;
};

async function sendMissedSessionRecovery() {
  const users = (await getClassUsers()).filter((u) => !u.isTrial && u.deviceToken);
  if (!users.length) return 0;

  const nowUtc = moment.utc();
  const todayPkt = moment.tz(PKT).startOf("day");
  const yesterdayPkt = todayPkt.clone().subtract(1, "day");
  const [todayClasses, yesterdayClasses] = await Promise.all([classesOn(todayPkt), classesOn(yesterdayPkt)]);

  const herLastEnd = (list, u) => {
    const mine = list.filter((x) => x.s.status !== "Cancelled" && isHerClass(u, x.s));
    if (!mine.length) return null;
    return mine.reduce((a, b) => (b.endUtc.isAfter(a) ? b.endUtc : a), mine[0].endUtc);
  };

  let sent = 0;
  for (const u of users) {
    try {
      const quiet = await isInQuietHours(u.id);
      const localNow = nowUtc.clone().tz(u.timeZone || PKT);

      // ── 1. Same evening (today's classes) ─────────────────────────────
      const dayKey = todayPkt.format("YYYY-MM-DD");
      const lastEnd = herLastEnd(todayClasses, u);
      if (lastEnd && !(await wasSent(u.id, dayKey))) {
        const sendAt = lastEnd.clone().add(AFTER_MIN, "minutes");
        const due = nowUtc.isSameOrAfter(sendAt) && nowUtc.isBefore(sendAt.clone().add(EVENING_WINDOW_H, "hours"));
        if (due && !quiet) {
          if (await attendedOn(u.id, todayPkt)) {
            await markSent(u.id, dayKey);
          } else {
            const tomorrow = (await classesOn(todayPkt.clone().add(1, "day")))
              .filter((x) => isHerClass(u, x.s))
              .sort((a, b) => a.startUtc - b.startUtc)[0];
            await sendNotification(
              [u.deviceToken],
              {
                title: "Missed Session",
                body: tomorrow
                  ? `No worries if today got busy 💚 Your next class is tomorrow at ${label(tomorrow, u.timeZone)}.`
                  : "No worries if today got busy 💚 Open Fit Her to get back on track with your next class.",
              },
              { type: "missedRecovery", date: dayKey }
            );
            await markSent(u.id, dayKey);
            sent++;
          }
          continue;
        }
      }

      // ── 2. Next morning (yesterday's evening fell in quiet hours) ─────
      const yKey = yesterdayPkt.format("YYYY-MM-DD");
      const yLastEnd = herLastEnd(yesterdayClasses, u);
      if (
        yLastEnd &&
        !quiet &&
        localNow.hour() >= MORNING_FROM_HOUR &&
        localNow.hour() < MORNING_CUTOFF_HOUR &&
        nowUtc.isAfter(yLastEnd.clone().add(AFTER_MIN, "minutes")) &&
        !(await wasSent(u.id, yKey))
      ) {
        if (await attendedOn(u.id, yesterdayPkt)) {
          await markSent(u.id, yKey);
          continue;
        }
        const next = todayClasses
          .filter((x) => x.s.status !== "Cancelled" && isHerClass(u, x.s) && x.startUtc.isAfter(nowUtc))
          .sort((a, b) => a.startUtc - b.startUtc)[0];
        await sendNotification(
          [u.deviceToken],
          {
            title: "Missed Session",
            body: next
              ? `Missed yesterday? No worries 💚 Your ${label(next, u.timeZone)} is waiting today.`
              : "Missed yesterday? No worries 💚 Open Fit Her and pick up where you left off.",
          },
          { type: "missedRecovery", date: yKey }
        );
        await markSent(u.id, yKey);
        sent++;
      }
    } catch (e) {
      console.error("[missed-recovery] user", u.id, e.message);
    }
  }
  return sent;
}

module.exports = { sendMissedSessionRecovery };
