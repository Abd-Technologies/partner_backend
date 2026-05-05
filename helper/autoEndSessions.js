const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { Slot, Time } = require("../models");
const { CANONICAL_TZ, parseEndAsUtc } = require("./timeFormats");

const GRACE_MINUTES = 2;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Sweeps every "In Progress" slot and flips it to "Completed" if either:
//   1. It's the slot's weekday today and now > slot.end + GRACE minutes, OR
//   2. It's NOT the slot's weekday today (stale from a past day — the
//      midnight reset cron didn't catch it for some reason).
//
// Why this exists:
//   Trainers are supposed to hit the manual "End Session" button. If they
//   forget, "In Progress" persists, the user-side schedule keeps showing
//   green "Join now" past the end of class, and admin loses the signal of
//   "did the trainer end it cleanly?". This cron flips stale rows so the
//   end-of-class state matches reality, with a 2-minute grace so a trainer
//   running a few minutes long isn't auto-cut.
//
// Returns array of slot IDs that were flipped (for logging).
async function autoEndExpiredSessions() {
  const inProgressSlots = await Slot.findAll({
    where: { status: "In Progress" },
    include: [{ model: Time, attributes: ["id", "day"] }],
  });

  if (inProgressSlots.length === 0) return [];

  // "Today" is anchored to PKT — that's the timezone the canonical
  // AM/PM data is in, and it's also what every user-facing surface
  // shows. Using UTC weekday here would mean evening PKT slots
  // (which span the UTC day boundary) get misclassified as stale.
  const nowUtc = moment.utc();
  const todayPkt = moment.tz(CANONICAL_TZ);
  const todayPktDayName = WEEKDAY_NAMES[todayPkt.day()];

  const toEnd = [];
  for (const slot of inProgressSlots) {
    const dayName = slot.Time && slot.Time.day;
    if (!dayName) continue;

    // Stale day — slot belongs to a different PKT weekday. Definitely past.
    if (dayName !== todayPktDayName) {
      toEnd.push(slot.id);
      continue;
    }

    const endUtc = parseEndAsUtc(slot.end, todayPkt);
    if (!endUtc) continue;

    const cutoff = endUtc.clone().add(GRACE_MINUTES, "minutes");
    if (nowUtc.isAfter(cutoff)) toEnd.push(slot.id);
  }

  if (toEnd.length === 0) return [];

  // completed_by stays NULL — that's the audit signal saying "the cron
  // did this, the trainer never clicked End". status_changed_at is set
  // so we can rank the events on the audit dashboard.
  await Slot.update(
    {
      status: "Completed",
      completed_by: null,
      status_changed_at: new Date(),
    },
    { where: { id: { [Op.in]: toEnd } } }
  );
  return toEnd;
}

module.exports = { autoEndExpiredSessions, GRACE_MINUTES };
