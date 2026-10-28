// "Your consultation was cancelled" in-app pop-up (Oct 2026).
// Queued whenever a consultation is cancelled by the dietitian or by the
// system — never when she cancels it herself:
//   dietitian_cancelled  the dietitian (or admin) cancelled it
//   dietitian_no_show    the dietitian didn't join
//   client_no_show       she didn't join (dietitian joined)
// Not for "never confirmed": bookings auto-confirm (appointmentController
// creates them as "confirmed"), so that case can't happen any more.
// The app shows it as URGENT (pop-up manager: skips the daily limits).
// The push for each case is sent where it happens, as before.
const { Op } = require("sequelize");
const moment = require("moment-timezone");

const POPUP = "POPUP_CONSULTATION_CANCELLED";
// Same 48 h the Diet tab keeps showing the cancelled card.
const MAX_AGE_HOURS = 48;

async function queueConsultationCancelled(appointment, reason, extra = {}) {
  try {
    if (!appointment || !appointment.userId) return;
    // Lazy require: popupEligibility requires noShowResolution, which
    // calls this.
    const popupEligibility = require("./popupEligibility");
    await popupEligibility.setEligible(appointment.userId, POPUP, new Date(), {
      cycle: `appt${appointment.id}`,
      appointmentId: appointment.id,
      kind: appointment.kind || "initial",
      reason,
      ...extra,
    });
  } catch (e) {
    console.error("[consultation-cancelled] popup failed:", e.message);
  }
}

async function retireOldConsultationCancelledPopups() {
  const { PendingPopupState } = require("../models");
  await PendingPopupState.update(
    { completedAt: new Date() },
    {
      where: {
        popupVariable: POPUP,
        completedAt: null,
        eligibleAt: { [Op.lt]: moment().subtract(MAX_AGE_HOURS, "hours").toDate() },
      },
    }
  );
}

module.exports = { POPUP, queueConsultationCancelled, retireOldConsultationCancelledPopups };
