// Resolves a confirmed appointment where the dietitian never showed up:
// cancels it outright and tells the client, instead of leaving it
// stuck at "confirmed" forever with a stuck grey/yellow Join Meeting
// button and no real resolution on screen.
//
// Called from two places:
//   - consultationBookingController.reportNoShow — the client taps
//     "Report" themselves.
//   - popupEligibility.evaluateConsultantNoShows — nobody reported it,
//     but 24 hours passed anyway (see NO_SHOW_STALE_HOURS), so the
//     system resolves it on its own instead of leaving it to rot.
//
// Deliberately reuses the existing `noShowReportedAt` timestamp (rather
// than a new status/column) as the signal that a "canceled" appointment
// specifically means "dietitian no-show" — the client app checks
// status === 'canceled' && noShowReportedAt set to show the dedicated
// "missed session, rebook free" card instead of a generic cancellation
// or the card just disappearing.
//
// Cancelling also mechanically "frees" the rebooking path for free:
// both the double-booking check (createAppointment) and the monthly
// consultation checkpoint gate already only count
// pending/confirmed/In-Progress/completed rows, so a canceled row never
// blocks a fresh booking or eats into her allowance.
const sendNotification = require("./notification");
const { User } = require("../models");

async function resolveDietitianNoShow(appointment, { actorUserId = null } = {}) {
  const alreadyResolved =
    appointment.status === "canceled" && !!appointment.noShowReportedAt;

  appointment.status = "canceled";
  appointment.noShowReportedAt = appointment.noShowReportedAt || new Date();
  // Audit signal, same convention as everywhere else in this codebase:
  // null = the system/cron resolved it, an id = that person did.
  appointment.completed_by = actorUserId;
  appointment.status_changed_at = new Date();
  await appointment.save();

  if (!alreadyResolved) {
    try {
      const user = await User.findByPk(appointment.userId);
      if (user && user.deviceToken) {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Session missed",
            body:
              "Your dietitian wasn't able to join this session, so we've " +
              "canceled it. Book a new time whenever works for you — no " +
              "charge, no hassle.",
          },
          { type: "appointmentNoShowCanceled" }
        );
      }
    } catch (e) {
      console.error("[noShowResolution] notify failed:", e);
    }
  }

  return appointment;
}

// Resolves a "pending" appointment (client booked it, dietitian never
// even confirmed it) once its scheduled time has passed with nothing
// happening. Unlike the no-show case, there's no grace period to wait
// out and no Meet attendance to check — nothing was ever confirmed, so
// the moment the slot time is in the past, it's unambiguous: it's not
// happening. Cancels it outright, tags it distinctly from a no-show via
// `expiredAt`, and tells the client to book a new time.
async function resolveUnconfirmedExpiry(appointment, { actorUserId = null } = {}) {
  const alreadyResolved =
    appointment.status === "canceled" && !!appointment.expiredAt;

  appointment.status = "canceled";
  appointment.expiredAt = appointment.expiredAt || new Date();
  appointment.completed_by = actorUserId;
  appointment.status_changed_at = new Date();
  await appointment.save();

  if (!alreadyResolved) {
    try {
      const user = await User.findByPk(appointment.userId);
      if (user && user.deviceToken) {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Booking expired",
            body:
              "Your dietitian didn't confirm this booking in time, so " +
              "we've canceled it. Book a new time whenever works for you " +
              "— no charge, no hassle.",
          },
          { type: "appointmentUnconfirmedExpired" }
        );
      }
    } catch (e) {
      console.error("[noShowResolution] unconfirmed-expiry notify failed:", e);
    }
  }

  return appointment;
}

module.exports = { resolveDietitianNoShow, resolveUnconfirmedExpiry };
