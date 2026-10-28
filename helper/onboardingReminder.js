// "Finish setting up Fit Her" — one push to a woman who made an account
// but stopped before the end of the sign-up questions.
//   sendFinishSignupReminders()  daily cron (app.js)
// Sent once per woman (Users.onboardingReminderAt), 20 hours to 7 days
// after she signed up, only if she has a phone token and no paid plan.
const { Op } = require("sequelize");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

async function sendFinishSignupReminders() {
  const { User } = require("../models");
  const now = Date.now();
  const users = await User.findAll({
    where: {
      userType: "User",
      status: { [Op.not]: true },
      onboardingDoneAt: null,
      onboardingReminderAt: null,
      deviceToken: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: "" }] },
      createdAt: { [Op.gte]: new Date(now - 7 * DAY), [Op.lte]: new Date(now - 20 * HOUR) },
    },
    attributes: ["id", "firstName", "deviceToken", "onboardingStep"],
    limit: 500,
  });
  let sent = 0;
  for (const u of users) {
    try {
      const first = String(u.firstName || "").trim();
      const left = Math.max(1, 6 - (u.onboardingStep || 0));
      await require("./notification")(
        [u.deviceToken],
        {
          title: first ? `${first}, finish setting up Fit Her 💚` : "Finish setting up Fit Her 💚",
          body: `${left === 1 ? "1 question" : left + " quick questions"} left, then your plan is ready.`,
        },
        { type: "finishSignup" }
      );
      sent++;
    } catch (e) {
      console.warn("[finish-signup] push", u.id, e.message);
    }
    // Mark even if the push failed (bad token): never more than one try.
    try {
      await User.update({ onboardingReminderAt: new Date() }, { where: { id: u.id } });
    } catch (_) {}
  }
  return sent;
}

module.exports = { sendFinishSignupReminders };
