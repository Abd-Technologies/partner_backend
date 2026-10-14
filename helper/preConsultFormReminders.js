// "Finish your health form" pushes — for paid clients who haven't opened
// the app to fill it (the form popup only shows inside the app).
//
// Runs daily (11:13 PKT). For every open POPUP_PRE_CONSULTATION_FORM row:
// a push on day 1, day 3 and day 7 after the form first opened for her
// (row.createdAt — eligibleAt is re-set to "today" on every evaluation,
// so it can't be used to count days) — 3 at most, then we stop. Tapping it opens the app, where the form shows. Quiet hours apply.
const moment = require("moment-timezone");
const Redis = require("ioredis");
const { PendingPopupState, User } = require("../models");
const sendNotification = require("./notification");

const redis = new Redis();
const STAGES = [1, 3, 7];

const MESSAGES = {
  1: { title: "Your health form is waiting 💚", body: "Two minutes, and your coach and dietitian can plan around you." },
  3: { title: "Help us personalise your plan", body: "Finish your short health form so your plan fits your body and cycle." },
  7: { title: "One small step left", body: "Your health form is still open. Complete it to get the most from Fit Her." },
};

async function sendPreConsultFormReminders() {
  const rows = await PendingPopupState.findAll({
    where: { popupVariable: "POPUP_PRE_CONSULTATION_FORM", completedAt: null },
    attributes: ["userId", "createdAt"],
  });
  let sent = 0;
  for (const r of rows) {
    if (!r.createdAt) continue;
    const days = moment().diff(moment(r.createdAt), "days");
    const stage = STAGES.find((d) => d === days);
    if (!stage) continue;
    try {
      const ok = await redis.set(`preconsultremind:${r.userId}:${stage}`, "1", "EX", 60 * 60 * 24 * 30, "NX");
      if (ok !== "OK") continue;
      const user = await User.findByPk(r.userId, { attributes: ["deviceToken"] });
      if (!user || !user.deviceToken) continue;
      await sendNotification([user.deviceToken], MESSAGES[stage], { type: "preConsultReminder" });
      sent++;
    } catch (e) {
      console.error("[preconsult-reminder] user", r.userId, e.message);
    }
  }
  return sent;
}

module.exports = { sendPreConsultFormReminders };
