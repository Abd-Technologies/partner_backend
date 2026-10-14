// classClash.js — does a live workout class run at the same time as a
// consultation? Used only for a small note on the "You're booked" screen:
//   "A live class runs at the same time. Yoga is on at 4:00 PM ...
//    Join after your consultation · 4:30 PM HIIT · Next class · 7:30 PM Zumba"
// Information only: never blocks a booking. Returns null when nothing
// overlaps or the client's package has no workouts.

const moment = require("moment-timezone");
const { Op } = require("sequelize");
const { Slot, Time, UserPlan, Plan } = require("../models");
const { CANONICAL_TZ, parseEndAsUtc } = require("./timeFormats");
const { activeUserPlanWhere } = require("./activePackage");

const WORKOUT_CATEGORY_IDS = [2, 3]; // Workout, Both (same as class reminders)

async function hasWorkoutPackage(userId) {
  const row = await UserPlan.findOne({
    where: { userId, ...activeUserPlanWhere() },
    include: [{ model: Plan, attributes: ["id"], where: { CategoryId: { [Op.in]: WORKOUT_CATEGORY_IDS } } }],
    attributes: ["id"],
  });
  return !!row;
}

function label(slot) {
  const type = (slot.type || "").trim() || "Live class";
  return { time: slot.start, type };
}

// dayStr "YYYY-MM-DD"; consultStart / consultEnd like "04:00 PM" (Pakistan time).
async function findClassClash(userId, dayStr, consultStart, consultEnd) {
  try {
    if (!dayStr || !consultStart || !consultEnd) return null;
    if (!(await hasWorkoutPackage(userId))) return null;

    const anchor = moment.tz(dayStr, "YYYY-MM-DD", CANONICAL_TZ);
    const cStart = parseEndAsUtc(consultStart, anchor);
    let cEnd = parseEndAsUtc(consultEnd, anchor);
    if (!cStart || !cEnd) return null;
    if (cEnd.isBefore(cStart)) cEnd = cEnd.clone().add(1, "day");

    const time = await Time.findOne({ where: { day: anchor.format("dddd") }, attributes: ["id"] });
    if (!time) return null;
    const slots = await Slot.findAll({
      where: { TimeId: time.id, trainerId: { [Op.ne]: null } },
      attributes: ["id", "start", "end", "type"],
    });

    const classes = slots
      .map((s) => {
        const st = parseEndAsUtc(s.start, anchor);
        let en = parseEndAsUtc(s.end, anchor);
        if (!st || !en) return null;
        if (en.isBefore(st)) en = en.clone().add(1, "day");
        return { s, st, en };
      })
      .filter(Boolean)
      .sort((a, b) => a.st.valueOf() - b.st.valueOf());

    // Overlap = class starts before the consultation ends and ends after it starts.
    const clash = classes.find((c) => c.st.isBefore(cEnd) && c.en.isAfter(cStart));
    if (!clash) return null;

    const after = classes.filter((c) => !c.st.isBefore(cEnd)).slice(0, 2);
    return {
      clashClass: label(clash.s),
      joinAfter: after[0] ? label(after[0].s) : null,
      nextClass: after[1] ? label(after[1].s) : null,
    };
  } catch (e) {
    console.error("[classClash]", e.message);
    return null;
  }
}

module.exports = { findClassClash };
