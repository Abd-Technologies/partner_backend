// "Finish your health form" pushes for paid clients who haven't filled it
// (the form pop-up only shows inside the app).
//
// Runs daily (11:13 PKT). For every open POPUP_PRE_CONSULTATION_FORM row
// with a live paid plan: up to 6 pushes, spaced by GAPS below. Tapping one
// opens the form directly in the app. Quiet hours apply.
const moment = require("moment-timezone");
const Redis = require("ioredis");
const { PendingPopupState, User } = require("../models");
const sendNotification = require("./notification");

const redis = new Redis();
// Up to 6 pushes while the form is open (Oct 2026), counted per user in
// redis instead of by the row's age, so old clients whose form row was
// created long ago still get them. Gaps (days) before push 1..6:
// 1 day after the form opened, then 2, 4, 7, 7, 7 days after the last one.
const GAPS = [1, 2, 4, 7, 7, 7];
const KEEP_SECONDS = 60 * 60 * 24 * 180;

const MESSAGES = [
  { title: "Your health form is waiting 💚", body: "Two minutes, and your team can plan around you." },
  { title: "Help us personalise your plan", body: "Finish your short health form so your plan fits your body and cycle." },
  { title: "One small step left", body: "Your health form is still open. Complete it to get the most from Fit Her." },
  { title: "Your plan works best with your answers", body: "A few quick questions are still open in your health form." },
  { title: "Still a few questions left 💚", body: "Finish your health form so your team can personalise your plan." },
  { title: "Last reminder: your health form", body: "It takes about 2 minutes. Your answers stay private to your team." },
];

async function sendPreConsultFormReminders() {
  const rows = await PendingPopupState.findAll({
    where: { popupVariable: "POPUP_PRE_CONSULTATION_FORM", completedAt: null },
    attributes: ["userId", "createdAt"],
  });
  let sent = 0;
  for (const r of rows) {
    if (!r.createdAt) continue;
    try {
      // Plan ended / paused / cancelled: no health-form pushes.
      const { UserPlan } = require("../models");
      const { activeUserPlanWhere } = require("./activePackage");
      const { Op } = require("sequelize");
      const live = await UserPlan.count({
        where: { userId: r.userId, ...activeUserPlanWhere(), isTrial: { [Op.not]: true } },
      });
      if (!live) continue;
      const countKey = `preconsultremind:count:${r.userId}`;
      const lastKey = `preconsultremind:last:${r.userId}`;
      let count = Number(await redis.get(countKey)) || 0;
      const storedLast = Number(await redis.get(lastKey)) || 0;
      const opened = moment(r.createdAt).valueOf();
      // A newer form row (e.g. a new package) starts its own series.
      if (storedLast && opened > storedLast) count = 0;
      if (count >= GAPS.length) continue; // all 6 sent
      const last = storedLast && opened <= storedLast ? storedLast : opened;
      // Small tolerance so a job that runs a few seconds earlier than the
      // last one still counts as "2 days later".
      if (moment().diff(moment(last), "days", true) < GAPS[count] - 0.05) continue;
      // Claim this send first so two runs can never double-push.
      const claimed = await redis.set(`preconsultremind:claim:${r.userId}:${count}`, "1", "EX", KEEP_SECONDS, "NX");
      if (claimed !== "OK") continue;
      await redis.set(countKey, String(count + 1), "EX", KEEP_SECONDS);
      await redis.set(lastKey, String(Date.now()), "EX", KEEP_SECONDS);
      const user = await User.findByPk(r.userId, { attributes: ["deviceToken"] });
      if (!user || !user.deviceToken) continue;
      await sendNotification([user.deviceToken], MESSAGES[count], { type: "preConsultReminder" });
      sent++;
    } catch (e) {
      console.error("[preconsult-reminder] user", r.userId, e.message);
    }
  }
  return sent;
}

module.exports = { sendPreConsultFormReminders };
