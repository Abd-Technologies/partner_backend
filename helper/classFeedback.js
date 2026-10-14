// Class feedback: when to ask, and what the home card shows.
// See fitHer Flows › Class feedback.
//
// Rules
//   • Only AFTER the class ended, up to 24 hours later.
//   • Only if she was in class at least 10 minutes.
//   • 1 ask per class (one row per user + class + day).
//   • Not again if she rated a class in the last 3 days.
//   • Skipped twice in a row → pause 7 days.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { ClassFeedback, ClassPresence, Slot, User } = require("../models");
const { parseEndAsUtc } = require("./timeFormats");

const PKT = "Asia/Karachi";
const MIN_SECONDS = 10 * 60;
const ASK_WINDOW_HOURS = 24;
const RATED_COOLDOWN_DAYS = 3;
const SKIP_PAUSE_DAYS = 7;

const GOOD_TAGS = ["Great energy", "Good pace", "Clear steps", "Good music", "Felt the burn", "Friendly trainer"];
const BAD_TAGS = ["Too fast", "Too hard", "Audio/video issue", "Started late", "Unclear steps", "Other"];

const fullName = (u) => (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "");
const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "FH";

/** Slot time (any stored format) as a UTC moment on that PKT day. */
function onDay(value, dayPkt) {
  const parsed = parseEndAsUtc(value, dayPkt);
  if (!parsed) return null;
  const local = parsed.clone().tz(PKT);
  return dayPkt.clone().startOf("day").hour(local.hour()).minute(local.minute()).utc();
}

/** true when the cooldown / pause rules say "don't ask now". */
async function inCooldown(userId) {
  const last = await ClassFeedback.findAll({
    where: { userId },
    order: [["updatedAt", "DESC"]],
    limit: 2,
    attributes: ["rating", "skipped", "updatedAt"],
  });
  if (!last.length) return false;
  const now = moment.utc();
  const rated = last.find((r) => r.rating != null);
  if (last[0].rating != null && now.diff(moment.utc(last[0].updatedAt), "days", true) < RATED_COOLDOWN_DAYS) return true;
  if (rated && now.diff(moment.utc(rated.updatedAt), "days", true) < RATED_COOLDOWN_DAYS) return true;
  if (last.length === 2 && last[0].skipped && last[1].skipped &&
      now.diff(moment.utc(last[0].updatedAt), "days", true) < SKIP_PAUSE_DAYS) return true;
  return false;
}

/**
 * Her classes from the last day and a half, newest first, as
 * { slot, classDate, startUtc, endUtc, seconds }.
 */
async function recentClasses(userId) {
  const rows = await ClassPresence.findAll({
    where: { userId, joinedAt: { [Op.gte]: moment.utc().subtract(36, "hours").toDate() } },
    order: [["joinedAt", "DESC"]],
    include: [{ model: Slot, as: "slot", include: [{ model: User, attributes: ["id", "firstName", "lastName"] }] }],
  });
  const groups = new Map();
  for (const p of rows) {
    if (!p.slot) continue;
    const dayPkt = moment.tz(p.joinedAt, PKT).startOf("day");
    const key = `${p.slotId}:${dayPkt.format("YYYY-MM-DD")}`;
    if (!groups.has(key)) {
      const startUtc = onDay(p.slot.start, dayPkt);
      const endUtc = onDay(p.slot.end, dayPkt);
      if (!startUtc || !endUtc) continue;
      if (endUtc.isBefore(startUtc)) endUtc.add(1, "day");
      groups.set(key, { slot: p.slot, classDate: dayPkt.format("YYYY-MM-DD"), startUtc, endUtc, seconds: 0 });
    }
    const g = groups.get(key);
    if (p.leftAt) {
      g.seconds += Number(p.durationSeconds) || 0;
    } else {
      // No "leave" (Zoom app, or the app was closed): count her as there
      // until the class ended.
      const until = moment.min(g.endUtc, moment.utc());
      g.seconds += Math.max(0, until.diff(moment.utc(p.joinedAt), "seconds"));
    }
  }
  return [...groups.values()];
}

/** The class the home card should ask about, or null. */
async function pendingFor(userId, tz) {
  if (await inCooldown(userId)) return null;
  const now = moment.utc();
  const classes = (await recentClasses(userId))
    .filter((c) => now.isAfter(c.endUtc) && now.diff(c.endUtc, "hours", true) <= ASK_WINDOW_HOURS)
    .sort((a, b) => b.endUtc.valueOf() - a.endUtc.valueOf());
  const c = classes[0];
  if (!c || c.seconds < MIN_SECONDS) return null;
  const done = await ClassFeedback.findOne({
    where: { userId, slotId: c.slot.id, classDate: c.classDate },
    attributes: ["id"],
  });
  if (done) return null;
  const trainerName = fullName(c.slot.User);
  return {
    slotId: c.slot.id,
    classDate: c.classDate,
    className: (c.slot.type || "class").trim(),
    trainerName: trainerName || "your trainer",
    trainerFirstName: (c.slot.User && c.slot.User.firstName) || "your trainer",
    trainerInitials: initials(trainerName),
    startLabel: c.startUtc.clone().tz(tz || PKT).format("h:mm A"),
    minutes: Math.round(c.seconds / 60),
    goodTags: GOOD_TAGS,
    badTags: BAD_TAGS,
  };
}

/** Her class that day (for saving): must have joined it, ended < 48h ago. */
async function findClass(userId, slotId, classDate) {
  const classes = await recentClasses(userId);
  return classes.find((c) => c.slot.id === Number(slotId) && c.classDate === classDate) || null;
}

module.exports = {
  GOOD_TAGS,
  BAD_TAGS,
  pendingFor,
  findClass,
  fullName,
};
