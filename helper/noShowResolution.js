// Resolves a confirmed appointment where the dietitian never showed up:
// cancels it outright and tells the client, instead of leaving it
// stuck at "confirmed" forever with a stuck grey/yellow Join Meeting
// button and no real resolution on screen.
//
// Called from two places:
//   - (formerly) the client tapping
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
const bookingPolicy = require("./bookingPolicy");
const { queueConsultationCancelled } = require("./consultationCancelledPopup");

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

  // Package compensation: the miss was ours, so add a fixed number of
  // days to her package end date. Only on the first resolution, so a
  // client report + the stale-no-show cron can't both add days.
  let daysAdded = 0;
  if (!alreadyResolved) {
    try {
      const plan = await bookingPolicy.planForAppointment(appointment);
      if (plan && plan.expireDate) {
        daysAdded = bookingPolicy.DIETITIAN_NO_SHOW_BONUS_DAYS;
        const newExpire = new Date(
          new Date(plan.expireDate).getTime() + daysAdded * 86400000
        );
        await plan.update({ expireDate: newExpire });
        await appointment.update({ noShowBonusDays: daysAdded });
        console.log(
          `[noShowResolution] dietitian no-show on appt ${appointment.id}: +${daysAdded}d on UserPlan ${plan.id}`
        );
      }
    } catch (e) {
      daysAdded = 0;
      console.error("[noShowResolution] compensation failed:", e);
    }
  }

  if (!alreadyResolved) {
    // In-app "consultation cancelled" pop-up (urgent in the app).
    await queueConsultationCancelled(appointment, "dietitian_no_show", { bonusDays: daysAdded });
    try {
      const user = await User.findByPk(appointment.userId);
      if (user && user.deviceToken) {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Your session was canceled",
            body:
              "Your dietitian couldn't join your session, so we've canceled it" +
              (daysAdded > 0
                ? ` and added ${daysAdded} free days to your package. `
                : ". ") +
              "Open the Diet tab to pick a new time. It's free.",
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

// The client didn't join but the dietitian did (Meet attendance, or the
// dietitian tapped "Client didn't join"). Cancels the appointment so it
// does NOT use up her initial / follow-up consultation (the booking gate
// only counts confirmed / In Progress / completed rows), tags it with
// clientNoShowAt so it's never counted against the dietitian, and asks
// her to book a new time.
async function resolveClientNoShow(appointment, { actorUserId = null } = {}) {
  const alreadyResolved =
    appointment.status === "canceled" && !!appointment.clientNoShowAt;
  if (alreadyResolved) return appointment;

  appointment.status = "canceled";
  appointment.clientNoShowAt = new Date();
  appointment.completed_by = actorUserId;
  appointment.status_changed_at = new Date();
  await appointment.save();

  // Change policy (helper/bookingPolicy.js): a missed session counts like
  // a late cancel. The first one per package is free (uses her one late
  // change); after that, self-booking is locked and staff are alerted so
  // they can contact her and rebook.
  let locked = false;
  try {
    const plan = await bookingPolicy.planForAppointment(appointment);
    if (plan) {
      if (!plan.lateChangeUsedAt) {
        plan.lateChangeUsedAt = new Date();
      } else {
        plan.bookingLockedAt = new Date();
        locked = true;
      }
      await plan.save();
    }
  } catch (e) {
    console.error("[noShowResolution] booking policy update failed:", e);
  }

  if (locked) {
    try {
      // Lazy require: escalation.js pulls in models + notification; kept
      // out of module load so this helper has no load-order surprises.
      const { createEscalation } = require("./escalation");
      await createEscalation({
        userId: appointment.userId,
        dietitianId: appointment.dietitionId || null,
        trigger: "CONSULT_CLIENT_NO_SHOW",
        severity: "high",
        payload: {
          appointmentId: appointment.id,
          scheduledDate: appointment.date,
          userPlanId: appointment.planId,
          bookingLocked: true,
          note: "Second missed session on this package. Self-booking is locked. Contact her, rebook, or reset her booking pass.",
        },
      });
    } catch (e) {
      console.error("[noShowResolution] lock escalation failed:", e);
    }
  }

  try {
    const user = await User.findByPk(appointment.userId);
    if (user && user.deviceToken) {
      await sendNotification(
        [user.deviceToken],
        locked
          ? {
              title: "We missed you today",
              body:
                "You missed your session again, so our team will reach out " +
                "to help you book a new time.",
            }
          : {
              title: "We missed you today 💚",
              body:
                "No problem, this one's on us. Book a new time and we'll " +
                "build your plan right after. Next time, please cancel at " +
                "least 24 hours ahead.",
            },
        { type: "appointmentClientNoShow" }
      );
    }
  } catch (e) {
    console.error("[noShowResolution] client no-show notify failed:", e);
  }
  await queueConsultationCancelled(appointment, "client_no_show", { locked });
  return appointment;
}

module.exports = { resolveDietitianNoShow, resolveUnconfirmedExpiry, resolveClientNoShow };
