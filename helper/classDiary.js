// Class diary — writes models/ClassSession.js. Add-on only: every function
// swallows its own errors so a class can never fail to start/end because
// of analytics.
//
//   started(slot, actor)          trainer/admin tapped Start
//   ended(slot, by, actorId)      by = trainer / admin / system (forgot to end)
//   cancelled(slot, {auto, actorId})
//   countDay(date)                fill joined / attended / avg minutes from
//                                 ClassPresence (run 23:55 PKT + on demand)
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { parseEndAsUtc } = require("./timeFormats");

const PKT = "Asia/Karachi";
const ATTENDED_SECONDS = require("./trialAttendance").minTrialAttendanceSeconds(); // 5 min (one rule)
const models = () => require("../models");

/** Slot wall-clock time ("6:00 PM") on a given PKT day, as a UTC moment. */
function onDay(value, dayPkt) {
  const parsed = parseEndAsUtc(value, dayPkt);
  if (!parsed) return null;
  const local = parsed.clone().tz(PKT);
  return dayPkt.clone().startOf("day").hour(local.hour()).minute(local.minute()).utc();
}

async function sessionFor(slot, dayPkt = moment.tz(PKT)) {
  const { ClassSession } = models();
  const date = dayPkt.format("YYYY-MM-DD");
  const start = onDay(slot.start, dayPkt);
  let end = onDay(slot.end, dayPkt);
  if (start && end && end.isSameOrBefore(start)) end = end.add(1, "day");
  const [row] = await ClassSession.findOrCreate({
    where: { slotId: slot.id, date },
    defaults: {
      trainerId: slot.trainerId || null,
      className: (slot.type || "class").trim().slice(0, 120),
      scheduledStart: start ? start.toDate() : null,
      scheduledEnd: end ? end.toDate() : null,
    },
  });
  return row;
}

async function started(slot, actor) {
  try {
    const row = await sessionFor(slot);
    if (row.startedAt) return; // a restart after a drop keeps the first start
    const now = new Date();
    row.startedAt = now;
    row.startedById = actor ? actor.id : null;
    row.status = "live";
    row.trainerId = slot.trainerId || row.trainerId;
    if (row.scheduledStart) {
      row.startLateMinutes = Math.round((now - new Date(row.scheduledStart)) / 60000);
    }
    try {
      row.usedOtherLink = !!(slot.usesBackupLink && slot.usesBackupLink());
    } catch (_) {}
    await row.save();
  } catch (e) {
    console.error("[class-diary] started:", e.message);
  }
}

async function ended(slot, by, actorId = null) {
  try {
    const { ClassSession } = models();
    // The open (live) session for this class, even if it began yesterday.
    let row = await ClassSession.findOne({
      where: { slotId: slot.id, status: "live" },
      order: [["date", "DESC"]],
    });
    if (!row) row = await sessionFor(slot);
    if (row.endedAt) return;
    row.endedAt = new Date();
    row.endedBy = by;
    row.endedById = actorId;
    row.status = "completed";
    await row.save();
  } catch (e) {
    console.error("[class-diary] ended:", e.message);
  }
}

async function cancelled(slot, { auto = false, actorId = null } = {}) {
  try {
    const row = await sessionFor(slot);
    row.status = auto ? "auto_cancelled" : "cancelled";
    row.cancelledAt = new Date();
    row.cancelledById = auto ? null : actorId;
    await row.save();
  } catch (e) {
    console.error("[class-diary] cancelled:", e.message);
  }
}

/** Joined / attended (10+ min) / average minutes for every class on [date]. */
async function countDay(date = moment.tz(PKT).format("YYYY-MM-DD")) {
  const { ClassSession, ClassPresence } = models();
  const dayStart = moment.tz(date, PKT).startOf("day");
  const dayEnd = dayStart.clone().add(1, "day");
  const sessions = await ClassSession.findAll({ where: { date } });
  let counted = 0;
  for (const s of sessions) {
    try {
      const rows = await ClassPresence.findAll({
        where: { slotId: s.slotId, joinedAt: { [Op.gte]: dayStart.toDate(), [Op.lt]: dayEnd.toDate() } },
        attributes: ["userId", "joinedAt", "leftAt", "durationSeconds"],
      });
      const until = s.endedAt || s.scheduledEnd || new Date();
      const perUser = new Map();
      for (const p of rows) {
        let secs = Number(p.durationSeconds) || 0;
        if (!p.leftAt) {
          // No "leave" (Zoom app / app closed): count until the class ended.
          secs = Math.max(secs, Math.floor((new Date(until) - new Date(p.joinedAt)) / 1000));
        }
        perUser.set(p.userId, (perUser.get(p.userId) || 0) + Math.max(0, secs));
      }
      const attended = [...perUser.values()].filter((x) => x >= ATTENDED_SECONDS);
      s.joinedCount = perUser.size;
      s.attendedCount = attended.length;
      s.avgMinutes = attended.length ? Math.round(attended.reduce((a, b) => a + b, 0) / attended.length / 60) : null;
      s.countedAt = new Date();
      await s.save();
      counted++;
    } catch (e) {
      console.error("[class-diary] count", s.id, e.message);
    }
  }
  return counted;
}

module.exports = { started, ended, cancelled, countDay, sessionFor, ATTENDED_SECONDS };
