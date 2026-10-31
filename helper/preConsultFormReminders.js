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

// Oct 2026: same story as the app ("Your plan just got personal"), by
// package. {team} = dietitian / trainer / dietitian and trainer.
const MESSAGES = [
  { title: "Your plan just got personal 💚", body: "Tell us a few things and your plan fits your body. About 2 minutes." },
  { title: "Make your plan follow your cycle 🌸", body: "A few quick answers and your {plan} adapt to every phase." },
  { title: "Help {team} plan for you 🩺", body: "Your answers let {team} keep your plan safe. Takes 2 minutes." },
  { title: "Your plan is still one-size-fits-all", body: "Finish a few questions so it's set for your body and cycle." },
  { title: "Almost there 💚", body: "Just a few answers left to make your plan truly yours." },
  { title: "Last reminder: your plan works best with your answers", body: "2 minutes now, a plan made for you." },
];

const WORDS = {
  diet: { team: "your dietitian", plan: "meals" },
  workout: { team: "your trainer", plan: "workouts" },
  combined: { team: "your dietitian and trainer", plan: "meals and workouts" },
};

function messageFor(index, planType) {
  const w = WORDS[planType] || WORDS.diet;
  const fill = (t) =>
    t
      .replace("{team}", w.team)
      .replace("{plan}", w.plan);
  const m = MESSAGES[index];
  return { title: fill(m.title), body: fill(m.body) };
}

// No push if the form pop-up was shown or put off in the app in the last
// 24 hours ("Later" an hour ago, then a push, felt pushy). Tried again on
// the next daily run.
const RECENT_POPUP_HOURS = 24;

async function sendPreConsultFormReminders() {
  const rows = await PendingPopupState.findAll({
    where: { popupVariable: "POPUP_PRE_CONSULTATION_FORM", completedAt: null },
    attributes: ["userId", "createdAt", "lastShownAt"],
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
      if (r.lastShownAt && moment().diff(moment(r.lastShownAt), "hours", true) < RECENT_POPUP_HOURS) continue;
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
      const { planTypeForUser } = require("./preConsultRequirements");
      const planType = (await planTypeForUser(r.userId)) || "diet";
      await sendNotification([user.deviceToken], messageFor(count, planType), { type: "preConsultReminder" });
      sent++;
    } catch (e) {
      console.error("[preconsult-reminder] user", r.userId, e.message);
    }
  }
  return sent;
}

module.exports = { sendPreConsultFormReminders };
