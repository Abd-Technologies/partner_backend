const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { Appointment, SlotDiet } = require("../models");
const { CANONICAL_TZ, parseEndAsUtc } = require("./timeFormats");

const GRACE_MINUTES = 2;

// Sweeps every "In Progress" Appointment and flips it to "completed" if
// its scheduled end + GRACE has passed.
//
// Why this exists:
//   The dietitian is supposed to mark the consultation completed when
//   they're done. If they forget, "In Progress" persists, the user-side
//   schedule keeps showing the session as live past the end of the slot,
//   and admin loses the signal of "did the dietitian end it cleanly?".
//   This cron flips stale rows so the post-session state matches reality,
//   with a 2-minute grace so a session running a few minutes long isn't
//   auto-cut.
//
// Difference vs autoEndExpiredSessions (trainer side):
//   Trainer Slots are weekday templates without dates, so the trainer
//   cron has to assume "today PKT" and discard any slot whose Time.day
//   doesn't match. Appointments carry a real Appointment.date, so we
//   anchor parseEndAsUtc to that calendar day directly. No "stale day"
//   bucket — every In Progress row has a knowable end moment.
//
// Returns array of appointment IDs that were flipped (for logging).
async function autoEndExpiredAppointments() {
  const inProgress = await Appointment.findAll({
    where: { status: "In Progress" },
    include: [{ model: SlotDiet, attributes: ["id", "start", "end"] }],
  });

  if (inProgress.length === 0) return [];

  const nowUtc = moment.utc();
  const toEnd = [];

  for (const appt of inProgress) {
    const slot = appt.SlotDiet;
    if (!slot || !slot.end) continue;
    if (!appt.date) continue;

    // Anchor the slot's wall-clock end to the appointment's calendar
    // day in PKT — that's the only way "10:30 PM" plus a date becomes
    // an absolute moment we can compare against now.
    const anchorPkt = moment.tz(appt.date, CANONICAL_TZ);
    const endUtc = parseEndAsUtc(slot.end, anchorPkt);
    if (!endUtc) continue;

    const cutoff = endUtc.clone().add(GRACE_MINUTES, "minutes");
    if (nowUtc.isAfter(cutoff)) toEnd.push(appt.id);
  }

  if (toEnd.length === 0) return [];

  // completed_by stays NULL — that's the audit signal saying "the cron
  // did this, the dietitian never clicked End". status_changed_at is
  // set so the audit dashboard can rank events.
  await Appointment.update(
    {
      status: "completed",
      completed_by: null,
      status_changed_at: new Date(),
    },
    { where: { id: { [Op.in]: toEnd } } }
  );
  return toEnd;
}

module.exports = { autoEndExpiredAppointments, GRACE_MINUTES };
