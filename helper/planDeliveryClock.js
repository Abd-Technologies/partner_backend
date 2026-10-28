// Plan-delivery clock (Oct 2026).
//
// A diet plan is owed within 48 WORKING hours of the consultation.
// Saturday and Sunday (Pakistan time) don't count, and neither do the
// dietitian's emergency days (helper/emergencyDay.js, applied ones).
// Used by: the dietitian's "plans to deliver" list (dietController), the
// client's "plan is being prepared" card (dietPlanController), the 24 h /
// 36 h reminders (planDeliveryReminders) and the 48 h breach
// (popupEligibility.evalPlanDelayed).
const moment = require("moment-timezone");
const { Op } = require("sequelize");

const TZ = "Asia/Karachi";
const PLAN_DUE_HOURS = 48;
const HOUR = 3600000;

async function skipDays(dietitianId, from) {
  const set = new Set();
  try {
    const { DietitianEmergencyDay } = require("../models");
    if (!dietitianId || !DietitianEmergencyDay) return set;
    const rows = await DietitianEmergencyDay.findAll({
      where: {
        dietitianId,
        status: "applied",
        day: {
          [Op.between]: [
            moment.tz(from, TZ).format("YYYY-MM-DD"),
            moment.tz(from, TZ).add(40, "days").format("YYYY-MM-DD"),
          ],
        },
      },
      attributes: ["day"],
    });
    rows.forEach((r) => set.add(String(r.day).slice(0, 10)));
  } catch (_) {
    /* table not ready: weekends only */
  }
  return set;
}

function isWorkingDay(m, skip) {
  const wd = m.day(); // 0 Sun … 6 Sat
  if (wd === 0 || wd === 6) return false;
  return !skip.has(m.format("YYYY-MM-DD"));
}

/** Working ms between two instants. */
function workingMs(start, end, skip) {
  let s = moment.tz(start, TZ);
  const e = moment.tz(end, TZ);
  if (!e.isAfter(s)) return 0;
  let total = 0;
  while (s.isBefore(e)) {
    const dayEnd = s.clone().endOf("day").add(1, "ms");
    const upTo = moment.min(dayEnd, e);
    if (isWorkingDay(s, skip)) total += upTo.diff(s);
    s = upTo;
  }
  return total;
}

/** The instant `hours` working hours after `start`. */
function addWorking(start, hours, skip) {
  let left = hours * HOUR;
  let s = moment.tz(start, TZ);
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const dayEnd = s.clone().endOf("day").add(1, "ms");
    if (isWorkingDay(s, skip)) {
      const avail = dayEnd.diff(s);
      if (avail >= left) return s.add(left, "ms").toDate();
      left -= avail;
    }
    s = dayEnd;
  }
  return s.toDate();
}

/** Working hours since `start` for this dietitian. */
async function workingHoursSince(start, dietitianId, now = new Date()) {
  const skip = await skipDays(dietitianId, start);
  return workingMs(start, now, skip) / HOUR;
}

/** When the plan is due (48 working hours after the consultation). */
async function dueAt(start, dietitianId, hours = PLAN_DUE_HOURS) {
  const skip = await skipDays(dietitianId, start);
  return addWorking(start, hours, skip);
}

module.exports = { PLAN_DUE_HOURS, workingHoursSince, dueAt, workingMs, addWorking };
