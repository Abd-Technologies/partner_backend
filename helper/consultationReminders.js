// consultationReminders.js — one automatic push to the client AND the
// dietitian 15 minutes before each confirmed consultation.
//
// Why: the only reminder used to be an in-app dialog 15 minutes before,
// which she only saw if the app was open. A forgotten session now counts
// as a missed one (uses her free late change / can lock booking), so she
// deserves a real heads-up.
//
// Runs every 5 minutes (app.js). Picks confirmed sessions starting 10-20
// minutes from now that haven't been reminded yet, marks them first
// (Appointment.reminderSentAt) so a slow send can never repeat, then
// notifies both sides. Skips bookings made less than 30 minutes before
// the session (she just booked it; no reminder needed).

const { Op } = require("sequelize");
const { Appointment, User, SlotDiet } = require("../models");
const sendNotification = require("./notification");
const { formatPkTime, sessionStartSync } = require("./bookingPolicy");

// About 15 minutes before (cron every 5 min, so a 10-20 min window).
const WINDOW_FROM_MIN = 10;
const WINDOW_TO_MIN = 20;
// Booked less than 30 minutes before: she just booked it, skip.
const MIN_LEAD_MIN = 30;

async function sendConsultationReminders() {
  const now = Date.now();
  // Appointment.date is only the session DAY (midnight); the start time is
  // on the slot. Load today's and tomorrow's confirmed bookings and work
  // out each real start time from day + slot.
  const candidates = await Appointment.findAll({
    where: {
      status: "confirmed",
      reminderSentAt: null,
      paymentHoldAt: null,
      date: {
        [Op.gte]: new Date(now - 36 * 3600000),
        [Op.lte]: new Date(now + 36 * 3600000),
      },
    },
    include: [{ model: SlotDiet, attributes: ["id", "start", "end"] }],
  });
  const rows = candidates.filter((a) => {
    const start = sessionStartSync(a, a.SlotDiet);
    if (!start) return false;
    const mins = (start.getTime() - now) / 60000;
    return mins >= WINDOW_FROM_MIN && mins <= WINDOW_TO_MIN;
  });

  let sent = 0;
  for (const appt of rows) {
    try {
      // Claim it atomically so two server processes can't both send.
      const [claimed] = await Appointment.update(
        { reminderSentAt: new Date() },
        { where: { id: appt.id, reminderSentAt: null } }
      );
      if (!claimed) continue;

      const start = sessionStartSync(appt, appt.SlotDiet);
      const created = appt.createdAt ? new Date(appt.createdAt) : null;
      if (created && start.getTime() - created.getTime() < MIN_LEAD_MIN * 60000) {
        continue; // booked just now
      }

      const time = formatPkTime(start);
      const [client, dietitian] = await Promise.all([
        User.findByPk(appt.userId, { attributes: ["firstName", "lastName", "deviceToken"] }),
        User.findByPk(appt.dietitionId, { attributes: ["firstName", "lastName", "deviceToken"] }),
      ]);
      const dietFirst = (dietitian && dietitian.firstName) || "your dietitian";
      const clientName =
        `${(client && client.firstName) || ""} ${(client && client.lastName) || ""}`.trim() ||
        "Your client";
      const data = { type: "consultationReminder", appointmentId: String(appt.id) };

      if (client && client.deviceToken) {
        await sendNotification(
          [client.deviceToken],
          {
            title: "Your consultation starts in 15 minutes",
            body:
              `Your session with ${dietFirst} starts at ${time}. Open the Diet tab ` +
              "now; your Join button turns green when she starts.",
          },
          data
        );
      }
      if (dietitian && dietitian.deviceToken) {
        await sendNotification(
          [dietitian.deviceToken],
          {
            title: "Consultation in 15 minutes",
            body:
              `${clientName} at ${time}. Tap "Start session & join call" in ` +
              "Your Consultations when it's time.",
          },
          data
        );
      }
      sent += 1;
    } catch (e) {
      console.error("[consultationReminders] appt", appt.id, e.message);
    }
  }
  return sent;
}

module.exports = { sendConsultationReminders };
