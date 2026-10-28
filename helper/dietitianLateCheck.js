// Dietitian late / no-show while the client waits (Oct 2026).
//
// A confirmed consultation the dietitian hasn't STARTED (status stays
// "confirmed"; her Start button sets "In Progress"):
//   • NO_SHOW_MINUTES (10) after the start time → cancelled as a
//     dietitian no-show (helper/noShowResolution.js: +3 days on her
//     package, urgent pop-up + push to her, free rebooking), an admin
//     alert, and pushes to every admin and the dietitian.
//   (Oct 2026: was a 10-min warning then cancel at 30; now cancel at 10.)
// Before this, nothing happened until after the session (Meet check, only
// with a linked Google account) or the next-day fallback.
// A session the Meet check already saw the dietitian attend is skipped.
const { Op } = require("sequelize");
const sendNotification = require("./notification");
const bookingPolicy = require("./bookingPolicy");

const NO_SHOW_MINUTES = 10;
const LATE_ALERT_MINUTES = 5; // Oct 2026: warn at 5 min late, cancel at 10
const LOOKBACK_DAYS = 2;

const M = () => require("../models");

async function adminTokens() {
  const { User } = M();
  const rows = await User.findAll({
    where: { userType: { [Op.like]: "admin%" }, deviceToken: { [Op.ne]: null } },
    attributes: ["deviceToken"],
  });
  return rows.map((r) => r.deviceToken).filter(Boolean);
}

function name(u) {
  return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || "A client" : "A client";
}

async function runDietitianLateCheck() {
  const { Appointment, User } = M();
  const now = Date.now();
  const since = new Date(now - LOOKBACK_DAYS * 86400000);
  const rows = await Appointment.findAll({
    where: { status: "confirmed", date: { [Op.gte]: since }, noShowReportedAt: null, paymentHoldAt: null },
  });
  let alerted = 0;
  let cancelled = 0;
  for (const appt of rows) {
    try {
      if (appt.meetDietitianAttended === true) continue;
      const start = await bookingPolicy.sessionStart(appt);
      if (!start) continue;
      const late = (now - start.getTime()) / 60000;
      if (late < LATE_ALERT_MINUTES) continue;

      const [client, dietitian] = await Promise.all([
        User.findByPk(appt.userId, { attributes: ["id", "firstName", "lastName", "deviceToken"] }),
        User.findByPk(appt.dietitionId, { attributes: ["id", "firstName", "lastName", "deviceToken"] }),
      ]);
      const when = bookingPolicy.formatPkTime(start);

      if (late >= NO_SHOW_MINUTES) {
        if (dietitian && dietitian.deviceToken) {
          await sendNotification(
            [dietitian.deviceToken],
            { title: "Session cancelled", body: `${name(client)}'s ${when} session wasn't started within ${NO_SHOW_MINUTES} minutes, so it was cancelled.` },
            { type: "appointmentNoShowCanceled" }
          );
        }
        await require("./noShowResolution").resolveDietitianNoShow(appt, { actorUserId: null });
        try {
          await require("./escalation").createEscalation({
            userId: appt.userId,
            dietitianId: appt.dietitionId,
            trigger: "CONSULT_NO_SHOW",
            severity: "medium",
            payload: { appointmentId: appt.id, scheduledDate: appt.date, detectedVia: "notStarted10min" },
          });
        } catch (e) {
          console.error("[dietitian-late] escalation:", e.message);
        }
        const tokens = await adminTokens();
        if (tokens.length) {
          await sendNotification(
            tokens,
            { title: "Session cancelled: dietitian didn't start", body: `${name(dietitian)} didn't start ${name(client)}'s ${when} session. Cancelled, 3 days added for the client.` },
            { type: "escalation" }
          );
        }
        cancelled++;
        continue;
      }

      if (!appt.dietitianLateAlertAt) {
        appt.dietitianLateAlertAt = new Date();
        await appt.save();
        if (dietitian && dietitian.deviceToken) {
          await sendNotification(
            [dietitian.deviceToken],
            { title: "Your client is waiting", body: `${name(client)}'s ${when} session hasn't started. Please start it now.` },
            { type: "appointmentLate" }
          );
        }
        // Oct 2026: tell HER too (essential, never a nudge). Tap → Diet tab.
        if (client && client.deviceToken) {
          const cutoff = bookingPolicy.formatPkTime(new Date(start.getTime() + NO_SHOW_MINUTES * 60000));
          await sendNotification(
            [client.deviceToken],
            {
              title: "Your dietitian is running a little late",
              body: `Hang on, she'll start soon. If she hasn't started by ${cutoff}, we cancel it for free, add 3 days to your package and you can book a new time.`,
            },
            { type: "appointmentDietitianLate", appointmentId: String(appt.id) }
          );
        }
        const tokens = await adminTokens();
        if (tokens.length) {
          await sendNotification(
            tokens,
            { title: "Dietitian running late", body: `${name(dietitian)} hasn't started ${name(client)}'s ${when} session (${Math.round(late)} min late).` },
            { type: "escalation" }
          );
        }
        alerted++;
      }
    } catch (e) {
      console.error("[dietitian-late] appt", appt.id, e.message);
    }
  }
  return { alerted, cancelled };
}

module.exports = { runDietitianLateCheck, LATE_ALERT_MINUTES, NO_SHOW_MINUTES };
