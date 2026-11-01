// "How was your session?" push (Nov 2026).
//
// The rating card only sat on her Diet tab, so most women never saw it.
// Once a consultation is over AND we know she was in it (she tapped Join,
// or the dietitian said "Yes, she joined", or Google saw her), she gets
// one push. Tapping it opens the Diet tab with the rating card. Once per
// consultation; never when she already rated it.

const sendNotification = require("./notification");

let _redis = null;
function redis() {
  if (_redis) return _redis;
  try {
    const Redis = require("ioredis");
    _redis = new Redis();
    _redis.on("error", () => {});
  } catch (_) {
    _redis = null;
  }
  return _redis;
}
async function claim(key) {
  try {
    const r = redis();
    if (r) return (await r.set(key, "1", "EX", 30 * 86400, "NX")) === "OK";
  } catch (_) {}
  return true;
}

async function askForReview(appointmentId) {
  try {
    const { Appointment, AppointmentReview, User } = require("../models");
    const appt = await Appointment.findByPk(appointmentId);
    if (!appt || appt.status !== "completed" || appt.clientNoShowAt) return false;
    const wasThere =
      !!appt.clientJoinTapAt || appt.attendanceFlag === "dietitian_confirmed" || appt.meetClientAttended === true;
    if (!wasThere) return false; // wait for the dietitian's "Yes, she joined"
    if (await AppointmentReview.findOne({ where: { appointmentId: appt.id }, attributes: ["id"] })) return false;
    if (!(await claim(`consultreview:${appt.id}`))) return false;
    const [client, dietitian] = await Promise.all([
      User.findByPk(appt.userId, { attributes: ["deviceToken"] }),
      User.findByPk(appt.dietitionId, { attributes: ["firstName"] }),
    ]);
    if (!client || !client.deviceToken) return false;
    const dn = (dietitian && dietitian.firstName) || "your dietitian";
    await sendNotification(
      [client.deviceToken],
      {
        title: `How was your session with ${dn}?`,
        body: "Tap to rate it. It takes 10 seconds and helps us look after you.",
      },
      { type: "consultationReview", appointmentId: String(appt.id) }
    );
    return true;
  } catch (e) {
    console.error("[consultReviewAsk]", appointmentId, e.message);
    return false;
  }
}

// Nov 2026: the rating matters, so one reminder if she hasn't rated
// 6 hours after the session ended (still inside the 48 h she can rate it).
// Runs every 30 min. Once per session.
async function remindReviews() {
  const { Op } = require("sequelize");
  const { Appointment, AppointmentReview, User } = require("../models");
  const now = Date.now();
  const rows = await Appointment.findAll({
    where: {
      status: "completed",
      clientNoShowAt: null,
      status_changed_at: { [Op.between]: [new Date(now - 40 * 3600000), new Date(now - 6 * 3600000)] },
    },
    attributes: ["id", "userId", "dietitionId", "clientJoinTapAt", "attendanceFlag", "meetClientAttended"],
  });
  let sent = 0;
  for (const appt of rows) {
    try {
      const wasThere =
        !!appt.clientJoinTapAt || appt.attendanceFlag === "dietitian_confirmed" || appt.meetClientAttended === true;
      if (!wasThere) continue;
      if (await AppointmentReview.findOne({ where: { appointmentId: appt.id }, attributes: ["id"] })) continue;
      if (!(await claim(`consultreview2:${appt.id}`))) continue;
      const [client, dietitian] = await Promise.all([
        User.findByPk(appt.userId, { attributes: ["deviceToken"] }),
        User.findByPk(appt.dietitionId, { attributes: ["firstName"] }),
      ]);
      if (!client || !client.deviceToken) continue;
      const dn = (dietitian && dietitian.firstName) || "your dietitian";
      await sendNotification(
        [client.deviceToken],
        {
          title: "Your rating matters 💚",
          body: `How was your session with ${dn}? Tap to rate it, it helps us look after you.`,
        },
        { type: "consultationReview", appointmentId: String(appt.id) }
      );
      sent++;
    } catch (e) {
      console.error("[consultReviewAsk] remind", appt.id, e.message);
    }
  }
  return sent;
}

module.exports = { askForReview, remindReviews };
