// Consultation join / leave times from the app (Nov 2026).
//
// Without Google Meet we can't see the call itself, so we build close-to-
// real times from what the app sees:
//   she joined   = her first "Join" tap (she waits until the dietitian starts)
//   she left     = the moment she came back to Fit Her after the call
//                  (estimated: if she never came back, the session's end)
//   dietitian    = "Start session" tap -> "End"/"Mark completed" tap, or
//                  the slot end when she forgot (marked "auto")
// Google data, when there is any, always wins (attendanceSource 'google').

const bookingPolicy = require("./bookingPolicy");

const toDate = (v) => (v ? new Date(v) : null);
const minutesBetween = (a, b) => (a && b ? Math.max(0, Math.round((b - a) / 60000)) : null);

/**
 * @param appt  Appointment (row or plain JSON) with SlotDiet if possible
 * @returns {object} summary for the portal / admin
 */
function summarize(appt, slot) {
  const s = slot || appt.SlotDiet || null;
  const slotStart = bookingPolicy.sessionStartSync(appt, s);
  const slotEnd = bookingPolicy.sessionEnd(appt, s);

  const dStart = toDate(appt.dietitianStartedAt);
  let dEnd = toDate(appt.dietitianEndedAt);
  let dEndSource = appt.dietitianEndSource || null;
  if (!dEnd && appt.status === "completed" && appt.status_changed_at) {
    // Older rows (before Nov 2026): completed time is the best we have.
    dEnd = toDate(appt.status_changed_at);
    dEndSource = appt.completed_by == null ? "auto" : "tap";
  }

  const cJoin = toDate(appt.clientJoinTapAt);
  const cLastTap = toDate(appt.clientLastJoinTapAt) || cJoin;
  const cBack = toDate(appt.clientReturnedAt);

  let cLeft = null;
  let cLeftHow = null; // 'app' (she came back to Fit Her) | 'end' (session end)
  if (cJoin) {
    if (cBack && (!cLastTap || cBack > cLastTap)) {
      cLeft = cBack;
      cLeftHow = "app";
    } else if (dEnd || (slotEnd && Date.now() > slotEnd.getTime())) {
      cLeft = dEnd || slotEnd;
      cLeftHow = "end";
    }
    // She can't be in the call long after the dietitian ended it.
    if (cLeft && dEnd && cLeft > new Date(dEnd.getTime() + 5 * 60000)) {
      cLeft = dEnd;
      cLeftHow = "end";
    }
  }

  // Time together: from when both were there until she left.
  const inFrom = cJoin && dStart ? new Date(Math.max(cJoin, dStart)) : cJoin;
  let clientMinutes = minutesBetween(inFrom, cLeft);
  let minutesFrom = clientMinutes != null ? "app" : null;
  if (clientMinutes == null && appt.dietitianReportedMinutes) {
    clientMinutes = appt.dietitianReportedMinutes;
    minutesFrom = "dietitian";
  }

  const google = appt.attendanceSource === "google";
  return {
    source: google ? "google" : "app",
    slotStart,
    slotEnd,
    dietitian: {
      startedAt: dStart,
      endedAt: dEnd,
      endedHow: dEndSource, // 'tap' | 'auto'
      minutes: minutesBetween(dStart, dEnd),
    },
    client: {
      joinedAt: cJoin,
      joins: appt.clientJoinTapCount || (cJoin ? 1 : 0),
      leftAt: cLeft,
      leftHow: cLeftHow, // 'app' = came back to Fit Her, 'end' = estimated
      minutes: clientMinutes,
      minutesFrom, // 'app' | 'dietitian'
      estimated: !google,
    },
  };
}

module.exports = { summarize };
