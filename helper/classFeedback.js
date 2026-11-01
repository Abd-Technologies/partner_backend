// Class feedback: when to ask, and what the home card shows.
// See fitHer Flows › Class feedback.
//
// Rules (Nov 2026)
//   RATING ("How was the class?")
//   • Only AFTER the class ended, up to 24 hours later. "Ended" also
//     means: the trainer pressed End today, or she left in the last
//     15 minutes of the class (so the app can ask right away).
//   • Only if she was in class at least HALF the class (min 10 minutes;
//     a class shorter than 10 min needs the whole class).
//   LEFT EARLY ("Why did you leave early?") — new app only (?early=1)
//   • She left (in the app) after 5+ minutes but before half the class.
//   • Asked right after she leaves, up to 24 hours after the class ends.
//   • One gentle question: It felt too hard / It felt too easy / Sound or
//     video trouble / Something came up / Something else. Not affected by the 3-day trainer pause.
//   BOTH
//   • 1 ask per class (one row per user + class + day).
//   • Per trainer: not again for the same trainer if she rated one of
//     that trainer's classes in the last 3 days. A class with a
//     different trainer can still be asked about (Oct 2026).
//   • Skipped twice in a row (any trainer) → pause 7 days.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { ClassFeedback, ClassPresence, Slot, User } = require("../models");
const { parseEndAsUtc } = require("./timeFormats");

const PKT = "Asia/Karachi";
const MIN_SECONDS = require("./trialAttendance").minTrialAttendanceSeconds(); // 5 min (one rule)
const ASK_WINDOW_HOURS = 24;
const RATED_COOLDOWN_DAYS = 3;
const SKIP_PAUSE_DAYS = 7;
const EARLY_ASK_MINUTES = 15;
const RATING_MIN_SECONDS = 10 * 60;
// Soft wording (Nov 2026): she should feel cared for, not questioned.
const EARLY_REASONS = ["It felt too hard", "It felt too easy", "Sound or video trouble", "Something came up", "Something else"];

/** Seconds she must stay to be asked for a rating: half the class, at
 *  least 10 minutes (or the whole class when it's shorter than that). */
function ratingNeedSeconds(c) {
  const len = Math.max(0, c.endUtc.diff(c.startUtc, "seconds"));
  return Math.max(Math.min(RATING_MIN_SECONDS, len), Math.round(len / 2));
}

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

/** true when she skipped the last two asks in a row (any trainer) less
 *  than SKIP_PAUSE_DAYS ago: she's tired of being asked, pause them all. */
async function inSkipPause(userId) {
  const last = await ClassFeedback.findAll({
    where: { userId },
    order: [["updatedAt", "DESC"]],
    limit: 2,
    attributes: ["skipped", "updatedAt"],
  });
  if (last.length < 2) return false;
  return (
    last[0].skipped &&
    last[1].skipped &&
    moment.utc().diff(moment.utc(last[0].updatedAt), "days", true) < SKIP_PAUSE_DAYS
  );
}

/** true when she rated a class with this same trainer in the last
 *  RATED_COOLDOWN_DAYS. A slot with no trainer falls back to the slot
 *  itself, so it's still asked at most once per 3 days. */
async function trainerInCooldown(userId, slot) {
  const since = moment.utc().subtract(RATED_COOLDOWN_DAYS, "days").toDate();
  const where = {
    userId,
    rating: { [Op.ne]: null },
    updatedAt: { [Op.gte]: since },
  };
  if (slot.trainerId) where.trainerId = slot.trainerId;
  else where.slotId = slot.id;
  const row = await ClassFeedback.findOne({ where, attributes: ["id"] });
  return !!row;
}

/**
 * Her classes from the last day and a half, newest first, as
 * { slot, classDate, startUtc, endUtc, seconds }.
 */
async function recentClasses(userId) {
  const rows = await ClassPresence.findAll({
    where: { userId, joinedAt: { [Op.gte]: moment.utc().subtract(36, "hours").toDate() } },
    order: [["joinedAt", "DESC"]],
    include: [{ model: Slot, as: "slot", paranoid: false, include: [{ model: User, attributes: ["id", "firstName", "lastName"] }] }],
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
      groups.set(key, { slot: p.slot, classDate: dayPkt.format("YYYY-MM-DD"), startUtc, endUtc, seconds: 0, open: false });
    }
    const g = groups.get(key);
    if (p.leftAt) {
      g.seconds += Number(p.durationSeconds) || 0;
    } else {
      g.open = true;
      // No "leave" (Zoom app, or the app was closed): count her as there
      // until the class ended.
      const until = moment.min(g.endUtc, moment.utc());
      g.seconds += Math.max(0, until.diff(moment.utc(p.joinedAt), "seconds"));
    }
  }
  return [...groups.values()];
}

/** Class over for her: time is up, the trainer ended it today, or she
 *  left (in the app) during the last 15 minutes. */
function isOver(c, now) {
  if (now.isAfter(c.endUtc)) return true;
  if (now.isBefore(c.startUtc)) return false;
  const today = moment.tz(PKT).format("YYYY-MM-DD");
  if (c.classDate === today && c.slot.status === "Completed") return true;
  return !c.open && now.isAfter(c.endUtc.clone().subtract(EARLY_ASK_MINUTES, "minutes"));
}

/** The class the home card should ask about, or null.
 *  [early]: the app can show "Why did you leave early?" (new app only). */
async function pendingFor(userId, tz, { early = false } = {}) {
  if (await inSkipPause(userId)) return null;
  const now = moment.utc();
  const cands = [];
  for (const c of await recentClasses(userId)) {
    if (now.diff(c.endUtc, "hours", true) > ASK_WINDOW_HOURS) continue;
    const need = ratingNeedSeconds(c);
    if (isOver(c, now) && c.seconds >= need) {
      cands.push({ c, kind: "rating" });
    } else if (early && !c.open && !now.isBefore(c.startUtc) && c.seconds >= MIN_SECONDS && c.seconds < need) {
      // She left (in the app) after 5+ min but before half the class.
      cands.push({ c, kind: "leftEarly" });
    }
  }
  cands.sort((a, b) => b.c.endUtc.valueOf() - a.c.endUtc.valueOf());
  // Newest class she can still be asked about: not yet asked (rated,
  // answered or skipped); for a rating, its trainer isn't in the 3-day pause.
  let c = null;
  let kind = null;
  for (const cand of cands) {
    const done = await ClassFeedback.findOne({
      where: { userId, slotId: cand.c.slot.id, classDate: cand.c.classDate },
      attributes: ["id"],
    });
    if (done) continue;
    if (cand.kind === "rating" && (await trainerInCooldown(userId, cand.c.slot))) continue;
    c = cand.c;
    kind = cand.kind;
    break;
  }
  if (!c) return null;
  const trainerName = fullName(c.slot.User);
  // After-class "well done" sheet (Nov 2026): what she did, in one place.
  const extra = await afterClassExtras(userId, c).catch(() => ({}));
  return {
    ...extra,
    kind, // "rating" | "leftEarly"
    earlyReasons: EARLY_REASONS,
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

/** Minutes / kcal (only when we know when she left), the class's
 *  benefit line, streak, trial progress and a Luna line for her phase. */
async function afterClassExtras(userId, c) {
  const tm = require("./trialMoments");
  const type = c.slot.type || "";
  const minutesKnown = !c.open;
  const minutes = Math.round(c.seconds / 60);
  const user = await User.findByPk(userId, { attributes: ["weight", "firstName"] });
  const out = {
    firstName: String((user && user.firstName) || "").trim().split(/\s+/)[0] || null,
    minutesKnown,
    kcal: minutesKnown && minutes > 0 ? tm.kcalFor(minutes, type, user && user.weight) : null,
    benefit: tm.benefitFor(type),
    streak: await require("./attendanceStats").streakDays(userId).catch(() => null),
    trial: null,
    luna: null,
    // Her next class with a reminder, for paid and trial alike (Nov 2026).
    nextClass: await tm.nextClassFor(userId),
  };
  const phase = await tm.phaseOf(userId);
  if (phase) out.luna = { label: phase.label, tip: phase.tip };
  try {
    const { TrialJourney } = require("../models");
    const journey = await TrialJourney.findOne({ where: { userId } });
    if (journey && journey.startedAt && !journey.convertedAt) {
      const { hasRealPaidPlan, trialWindow } = require("./trialOffer");
      if (!trialWindow(journey).ended && !(await hasRealPaidPlan(userId))) {
        out.trial = {
          attended: await require("./trialClasses").countTrialClassesAttended(userId, journey),
          goal: require("./trialState").getTrialClassGoal(),
        };
      }
    }
  } catch (_) {}
  return out;
}

/** Her class that day (for saving): must have joined it, ended < 48h ago. */
async function findClass(userId, slotId, classDate) {
  const classes = await recentClasses(userId);
  return classes.find((c) => c.slot.id === Number(slotId) && c.classDate === classDate) || null;
}

module.exports = {
  GOOD_TAGS,
  BAD_TAGS,
  EARLY_REASONS,
  pendingFor,
  findClass,
  fullName,
};
