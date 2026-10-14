// Who hears about a class — the one rule every workout class push uses.
//
// Class users:
//   • a live workout / combined package (not paused, expired or cancelled)
//   • a free trial that is still running
//
// Her classes:
//   • she picked reminder times (PreConsultationProfile.workoutSection
//     .preferredSlotIds) → only those classes;
//   • she never picked any → ALL classes.
//   • plus any "just this once" reminder she set for today
//     (workoutSection.oneTimeReminders: [{slotId, date: "YYYY-MM-DD" PKT}]).
//
// Used by: the 15-min reminder (crownjobfunction), trainer start / link /
// joined / cancel pushes (getDeviceTokensForSlot), and auto-cancel.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { UserPlan, Plan, User, TrialJourney, PreConsultationProfile } = require("../models");
const { activeUserPlanWhere } = require("./activePackage");
const { normalizeSlotTime } = require("./normalizeSlotTime");

const PKT = "Asia/Karachi";

// "08:00 PM" / "8:00 pm" -> "8:00 PM"
function normTime(t) {
  return String(t || "").trim().toUpperCase().replace(/^0/, "");
}

/** Slot's start time as she sees it (her time zone), e.g. "8:00 PM". */
function slotLocalTime(slot, tz) {
  const t = moment.tz(normalizeSlotTime(slot.start), "hh:mm A", true, PKT);
  if (!t.isValid()) return null;
  const at = moment.tz(PKT).startOf("day").hour(t.hour()).minute(t.minute());
  return normTime(at.clone().tz(tz || PKT).format("h:mm A"));
}

/** Slot ids of her one-time reminders that are for today (PKT date). */
function onceToday(ws) {
  const list = ws && Array.isArray(ws.oneTimeReminders) ? ws.oneTimeReminders : [];
  const today = moment.tz(PKT).format("YYYY-MM-DD");
  return list
    .filter((r) => r && String(r.date) === today)
    .map((r) => Number(r.slotId))
    .filter(Number.isFinite);
}

function asJson(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

/**
 * All class users with their picks.
 * @returns {Promise<Array<{id:number, deviceToken:string|null, timeZone:string|null, isTrial:boolean, picks:number[]}>>}
 */
async function getClassUsers() {
  const byId = new Map();

  const plans = await UserPlan.findAll({
    where: activeUserPlanWhere(),
    attributes: ["userId"],
    include: [{ model: Plan, attributes: [], where: { CategoryId: { [Op.in]: [2, 3] } } }],
  });
  plans.forEach((p) => p.userId && byId.set(p.userId, { isTrial: false }));

  if (TrialJourney) {
    let trialDays = 3;
    try { trialDays = require("./trialState").getTrialDays(); } catch (_) {}
    const trials = await TrialJourney.findAll({
      where: {
        convertedAt: null,
        startedAt: { [Op.gte]: moment().subtract(trialDays, "days").toDate() },
      },
      attributes: ["userId"],
    });
    trials.forEach((t) => {
      if (t.userId && !byId.has(t.userId)) byId.set(t.userId, { isTrial: true });
    });
  }

  const ids = [...byId.keys()];
  if (ids.length === 0) return [];

  const [users, profiles] = await Promise.all([
    User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "deviceToken", "timeZone"] }),
    PreConsultationProfile.findAll({ where: { userId: { [Op.in]: ids } }, attributes: ["userId", "workoutSection"] }),
  ]);
  const picksBy = new Map();
  const timesBy = new Map();
  const onceBy = new Map();
  profiles.forEach((p) => {
    const ws = asJson(p.workoutSection, {}) || {};
    const picks = Array.isArray(ws.preferredSlotIds)
      ? ws.preferredSlotIds.map(Number).filter(Number.isFinite)
      : [];
    picksBy.set(p.userId, picks);
    onceBy.set(p.userId, onceToday(ws));
    // Picked times ("8:00 PM", her time zone). Matching by time keeps
    // working when classes are re-created and get new ids.
    timesBy.set(
      p.userId,
      Array.isArray(ws.preferredTimes) ? ws.preferredTimes.map(normTime).filter(Boolean) : []
    );
  });

  return users.map((u) => ({
    id: u.id,
    deviceToken: u.deviceToken || null,
    timeZone: u.timeZone || null,
    isTrial: byId.get(u.id).isTrial,
    picks: picksBy.get(u.id) || [],
    times: timesBy.get(u.id) || [],
    once: onceBy.get(u.id) || [],
  }));
}

/**
 * True when this class is one of hers: she picked nothing (all classes),
 * or its id or its start time matches her picks.
 */
function isHerClass(user, slot) {
  const picks = user.picks || [];
  const times = user.times || [];
  if (picks.length === 0 && times.length === 0) return true;
  const id = typeof slot === "object" ? slot.id : slot;
  // "Just this once" reminder for today's class.
  if ((user.once || []).includes(Number(id))) return true;
  if (picks.includes(Number(id))) return true;
  if (typeof slot === "object" && times.length) {
    const local = slotLocalTime(slot, user.timeZone);
    if (local && times.includes(local)) return true;
  }
  return false;
}

/** Class users for whom this slot is one of "her classes". */
async function getClassAudience(slot, classUsers) {
  const all = classUsers || (await getClassUsers());
  return all.filter((u) => isHerClass(u, slot));
}

module.exports = { getClassUsers, getClassAudience, isHerClass, slotLocalTime, normTime, onceToday };
