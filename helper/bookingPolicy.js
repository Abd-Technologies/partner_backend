// Consultation change policy — single source of truth.
//
//   • More than 24h before the session: reschedule or cancel freely.
//   • Less than 24h before: no reschedule. She has ONE free "late change"
//     per package (UserPlan) — a late cancel OR a missed session.
//   • Once used: she can't cancel inside 24h, and if she misses anyway
//     her self-booking is locked (UserPlan.bookingLockedAt) until staff
//     help her rebook / reset it.
//   • Dietitian cancellations and dietitian no-shows never count.
const { UserPlan } = require("../models");

const LATE_CHANGE_HOURS = 24;
// Days added to her package when the DIETITIAN misses OR cancels a
// session (any time), so she never loses package time for our side.
// Fixed per session, given once.
const DIETITIAN_NO_SHOW_BONUS_DAYS = 3;
// The dietitian can start a session (which turns the client's Join
// button green) at most this many minutes before its scheduled time.
const START_EARLY_MINUTES = 10;
// Nov 2026: a booking must start at least this far ahead, so the dietitian
// sees it and can prepare (and the 15-minute reminder can go out). A slot
// starting sooner shows as not available.
// Set CONSULT_MIN_LEAD_MINUTES in .env to change it (e.g. 5 while testing).
const MIN_BOOK_LEAD_MINUTES = (() => {
  const n = parseInt(process.env.CONSULT_MIN_LEAD_MINUTES, 10);
  return Number.isInteger(n) && n >= 0 && n <= 24 * 60 ? n : 60;
})();

/** Too soon (or already past) to book this slot on this day? Only for
 *  "h:mm AM/PM" times; old 24-hour rows are never blocked by this. */
function tooSoonToBook(dayStr, slot) {
  if (!slot || !/^\s*\d{1,2}:\d{2}\s*[AaPp][Mm]\s*$/.test(String(slot.start || ""))) return false;
  const st = sessionStartSync({ date: dayStr }, slot);
  return !!st && st.getTime() < Date.now() + MIN_BOOK_LEAD_MINUTES * 60000;
}

// IMPORTANT: Appointment.date is the session's CALENDAR DAY (stored as
// midnight), NOT its start time. The start time lives on the slot
// (SlotDiet.start, "04:00 PM" Pakistan time). Everything time-based
// (24h rule, start window, "running late", reminders, no-show grace)
// must use sessionStart(), never appt.date directly.
async function slotFor(appt, transaction) {
  if (!appt) return null;
  if (appt.SlotDiet) return appt.SlotDiet;
  if (!appt.timeSlotId) return null;
  try {
    const { SlotDiet } = require("../models");
    return await SlotDiet.findByPk(appt.timeSlotId, { attributes: ["id", "start", "end"], transaction });
  } catch (_) {
    return null;
  }
}

// Session start (absolute time) from the day + the slot's start time.
function sessionStartSync(appt, slot) {
  try {
    if (!slot || !slot.start || !appt || !appt.date) return null;
    const moment = require("moment-timezone");
    const { CANONICAL_TZ, parseEndAsUtc } = require("./timeFormats");
    const startUtc = parseEndAsUtc(slot.start, moment.tz(appt.date, CANONICAL_TZ));
    return startUtc ? startUtc.toDate() : null;
  } catch (_) {
    return null;
  }
}

async function sessionStart(appt, transaction) {
  return sessionStartSync(appt, await slotFor(appt, transaction));
}

// Earliest moment the session can be started, or null if unknown.
async function earliestStart(appt) {
  const start = await sessionStart(appt);
  return start ? new Date(start.getTime() - START_EARLY_MINUTES * 60000) : null;
}

// When the session's slot ends (absolute time), or null if unknown.
// Same anchoring as autoEndExpiredAppointments: slot "10:20 PM" on the
// appointment's PKT calendar day.
function sessionEnd(appt, slot) {
  try {
    if (!slot || !slot.end || !appt || !appt.date) return null;
    const moment = require("moment-timezone");
    const { CANONICAL_TZ, parseEndAsUtc } = require("./timeFormats");
    const endUtc = parseEndAsUtc(slot.end, moment.tz(appt.date, CANONICAL_TZ));
    return endUtc ? endUtc.toDate() : null;
  } catch (_) {
    return null;
  }
}

function formatPkTime(d) {
  try {
    return d.toLocaleTimeString("en-US", {
      timeZone: "Asia/Karachi",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch (_) {
    return d.toISOString();
  }
}

// Nov 2026: a time for the CLIENT's push, in her own time zone (User.timeZone,
// saved from her phone). Pakistan time when her zone is unknown.
// withDay → "Tue 3 Nov, 5:00 PM", else "5:00 PM".
function formatForUser(d, tz, withDay = false) {
  try {
    const moment = require("moment-timezone");
    const zone = tz && moment.tz.zone(tz) ? tz : "Asia/Karachi";
    return moment(d).tz(zone).format(withDay ? "ddd D MMM, h:mm A" : "h:mm A");
  } catch (_) {
    return formatPkTime(d);
  }
}

async function hoursUntilStart(appt, transaction) {
  const start = await sessionStart(appt, transaction);
  if (!start) return Infinity;
  return (start.getTime() - Date.now()) / 3600000;
}

async function isInsideLateWindow(appt, transaction) {
  return (await hoursUntilStart(appt, transaction)) < LATE_CHANGE_HOURS;
}

async function planForAppointment(appt, transaction) {
  if (!appt || !appt.planId) return null;
  try {
    return await UserPlan.findByPk(appt.planId, { transaction });
  } catch (_) {
    return null;
  }
}

function lateChangeAvailable(plan) {
  return !plan || !plan.lateChangeUsedAt;
}

function bookingLocked(plan) {
  return !!(plan && plan.bookingLockedAt);
}

const MSG = {
  noReschedule:
    "Your session is less than 24 hours away, so the time can't be changed. You can still cancel it.",
  noLateChange:
    "Your session is less than 24 hours away and you've already used your one free late change for this package. If something urgent came up, please contact us.",
  locked:
    "You missed your last session, so our team will help you book a new time. Please contact us and we'll sort it out quickly.",
};

module.exports = {
  MIN_BOOK_LEAD_MINUTES,
  tooSoonToBook,
  LATE_CHANGE_HOURS,
  DIETITIAN_NO_SHOW_BONUS_DAYS,
  START_EARLY_MINUTES,
  earliestStart,
  sessionStart,
  sessionStartSync,
  slotFor,
  sessionEnd,
  formatPkTime,
  formatForUser,
  hoursUntilStart,
  isInsideLateWindow,
  planForAppointment,
  lateChangeAvailable,
  bookingLocked,
  MSG,
};
