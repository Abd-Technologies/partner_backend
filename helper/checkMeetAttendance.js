// checkMeetAttendance.js — sweeps consultations whose scheduled time
// has passed and fills in real Meet attendance data for the ones that
// have a link on file.
//
// Deliberately does NOT filter by Appointment.status. Turns out nothing
// in the app today actually flips a consultation to "In Progress" or
// "completed" in real usage (no client or dietitian UI calls the
// start/complete endpoints yet) — so most real bookings just stay
// "confirmed" forever. Filtering on status here would mean this sweep
// almost never finds anything. Instead it looks at ANY non-cancelled
// appointment that hasn't been checked yet, and lets
// meetAttendanceService's own time-window check (via
// appointmentWindowUtc + RECORD_SETTLE_MINUTES) decide whether it's
// actually over yet — same idea as the other auto-end crons, just
// driven by the real clock instead of a status flag nothing sets.
//
// Picks up Appointments that:
//   - aren't canceled (a canceled booking never happened; nothing to check)
//   - has a usable Meet link: either its own confirm-time snapshot
//     (meetLink) or, for older rows, its SlotDiet's live dietitionLink
//   - not yet checked (meetAttendanceCheckedAt is still null)
//   - happened within the last MAX_LOOKBACK_DAYS (don't retry ancient
//     rows forever — if we haven't found an answer by then, we're not
//     going to)
//
// For each one, asks meetAttendanceService for the real answer. A
// per-appointment try/catch means one bad lookup (a stale token, a
// weird link, a Google hiccup) never stops the rest of the sweep or
// crashes the process — it just gets picked up again next run.

const { Op } = require('sequelize');
const { Appointment, SlotDiet } = require('../models');
const { checkAttendanceForAppointment } = require('../services/meetAttendance/meetAttendanceService');
const { resolveDietitianNoShow } = require('./noShowResolution');
const { createEscalation } = require('./escalation');

const BATCH_SIZE = 25;
const MAX_LOOKBACK_DAYS = 30;

async function checkMeetAttendance() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_LOOKBACK_DAYS);

  const candidates = await Appointment.findAll({
    where: {
      status: { [Op.notIn]: ['canceled', 'canceledByUser'] },
      meetAttendanceCheckedAt: null,
      date: { [Op.gte]: cutoff },
    },
    include: [{ model: SlotDiet, attributes: ['id', 'start', 'end', 'dietitionLink'] }],
    limit: BATCH_SIZE,
    order: [['date', 'ASC']],
  });

  // An appointment has a usable link if EITHER its own frozen snapshot
  // (meetLink, taken at confirm time) or the slot's live link is set —
  // meetAttendanceService itself prefers the snapshot when both exist.
  const withLink = candidates.filter((appt) => {
    const own = appt.meetLink && appt.meetLink.trim();
    const live = appt.SlotDiet && appt.SlotDiet.dietitionLink && appt.SlotDiet.dietitionLink.trim();
    return own || live;
  });

  const results = { checked: 0, skipped: 0, errors: 0 };

  for (const appt of withLink) {
    try {
      const outcome = await checkAttendanceForAppointment(appt);

      if (outcome.skipped) {
        // "too_soon" isn't a real check yet — leave meetAttendanceCheckedAt
        // null so we try again next run instead of giving up on it.
        if (outcome.reason !== 'too_soon') {
          await appt.update({ meetAttendanceCheckedAt: new Date() });
        }
        results.skipped += 1;
        continue;
      }

      await appt.update({
        meetAttendanceCheckedAt: new Date(),
        meetDietitianAttended: outcome.dietitianAttended,
        meetClientAttended: outcome.clientAttended,
        meetConferenceRecordName: outcome.conferenceRecordName,
        meetAttendanceRaw: JSON.stringify(outcome.raw),
      });
      results.checked += 1;

      // Real evidence the dietitian never joined — resolve it right
      // now instead of leaving the client staring at a stuck
      // grey/yellow button for up to 24 hours waiting on the blind
      // time-based fallback (see popupEligibility.evaluateConsultantNoShows,
      // which now only fires when attendance couldn't be determined at
      // all). Only acts on appointments still "confirmed" — one already
      // resolved some other way is left alone.
      if (outcome.dietitianAttended === false && appt.status === 'confirmed') {
        await resolveDietitianNoShow(appt);
        try {
          await createEscalation({
            userId: appt.userId,
            dietitianId: appt.dietitionId,
            trigger: 'CONSULT_NO_SHOW',
            severity: 'medium',
            payload: {
              appointmentId: appt.id,
              scheduledDate: appt.date,
              detectedVia: 'meetAttendance',
              clientAttended: outcome.clientAttended,
            },
          });
        } catch (e) {
          console.error('[checkMeetAttendance] escalation create failed:', e);
        }
      }
    } catch (err) {
      // Leave meetAttendanceCheckedAt null so a transient failure (auth
      // hiccup, API error) gets retried next run instead of being
      // silently given up on.
      console.error(`[checkMeetAttendance] appointment ${appt.id} failed:`, err.message || err);
      results.errors += 1;
    }
  }

  return results;
}

module.exports = { checkMeetAttendance };
