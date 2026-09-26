const { Op } = require("sequelize");
const {
  Appointment,
  DietPlan,
  PdfDietsForUserNew,
  User,
} = require("../models");
const sendNotification = require("./notification");

// Plan delivery SLA reminders. A plan is owed within 48 hours of the
// consultation ending:
//   24h  -> gentle reminder to the dietitian
//   36h  -> urgent reminder to the dietitian + heads-up to admin
//   48h  -> handled by helper/popupEligibility.js evalPlanDelayed
//           (client apology popup + PLAN_DELAYED escalation ticket)
//
// Runs hourly. Each appointment falls inside each 1-hour window exactly
// once, so no extra "already sent" column is needed. If the server is
// down for that exact hour the reminder is skipped, and the 48h
// escalation still catches it.
const WINDOWS = [
  { fromH: 24, toH: 25, level: "24h" },
  { fromH: 36, toH: 37, level: "36h" },
];

async function isDelivered(userId, doneAt) {
  const ai = await DietPlan.findOne({
    where: { userId, activatedAt: { [Op.gte]: doneAt } },
    attributes: ["id"],
  });
  if (ai) return true;
  const pdf = await PdfDietsForUserNew.findOne({
    where: { userId, createdAt: { [Op.gte]: doneAt } },
    attributes: ["id"],
  });
  return !!pdf;
}

async function adminTokens() {
  const admins = await User.findAll({
    where: { userType: "Admin" },
    attributes: ["deviceToken"],
  });
  return admins
    .map((a) => a.deviceToken)
    .filter((t) => typeof t === "string" && t.length > 0);
}

async function sendPlanDeliveryReminders() {
  const now = Date.now();
  for (const w of WINDOWS) {
    const appts = await Appointment.findAll({
      where: {
        status: "completed",
        status_changed_at: {
          [Op.gt]: new Date(now - w.toH * 3600000),
          [Op.lte]: new Date(now - w.fromH * 3600000),
        },
      },
      attributes: ["id", "userId", "dietitionId", "status_changed_at"],
    });

    for (const a of appts) {
      try {
        // Only the client's LATEST completed consultation matters.
        const newer = await Appointment.findOne({
          where: {
            userId: a.userId,
            status: "completed",
            status_changed_at: { [Op.gt]: a.status_changed_at },
          },
          attributes: ["id"],
        });
        if (newer) continue;
        if (await isDelivered(a.userId, a.status_changed_at)) continue;

        const [client, dietitian] = await Promise.all([
          User.findByPk(a.userId, { attributes: ["firstName", "lastName"] }),
          a.dietitionId
            ? User.findByPk(a.dietitionId, { attributes: ["id", "deviceToken"] })
            : null,
        ]);
        const clientName =
          `${(client && client.firstName) || ""} ${(client && client.lastName) || ""}`.trim() ||
          "A client";
        const hoursLeft = 48 - w.fromH;
        const data = {
          type: "planDeliveryReminder",
          level: w.level,
          userId: String(a.userId),
          appointmentId: String(a.id),
        };

        if (dietitian && dietitian.deviceToken) {
          await sendNotification(
            [dietitian.deviceToken],
            w.level === "24h"
              ? {
                  title: "Plan due in 24 hours",
                  body: `${clientName}'s diet plan is due within 24 hours. Open Plans to deliver to create it.`,
                }
              : {
                  title: `Urgent: plan due in ${hoursLeft} hours`,
                  body: `${clientName} is still waiting for her plan. Please deliver it in the next ${hoursLeft} hours.`,
                },
            data
          );
        }

        if (w.level === "36h") {
          const tokens = await adminTokens();
          if (tokens.length) {
            await sendNotification(
              tokens,
              {
                title: "Plan at risk of running late",
                body: `${clientName}'s plan is 12 hours from its 48 hour deadline and not delivered yet.`,
              },
              data
            );
          }
        }
        console.log(
          `[planDeliveryReminders] ${w.level} reminder sent for appointment ${a.id} (user ${a.userId})`
        );
      } catch (e) {
        console.error(`[planDeliveryReminders] appointment ${a.id}:`, e.message);
      }
    }
  }
}

module.exports = { sendPlanDeliveryReminders };
