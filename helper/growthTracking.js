// Growth analytics — add-on records. Never throws, never blocks a flow.
//   activeDay(userId)      → one UserActiveDays row per woman per day
//   loggedIn(user, method) → Users.lastLoginAt / loginCount (+ active day)
//   signupInfo(body)       → { signupMethod, signupSource, signupCampaign }
const moment = require("moment-timezone");

const PKT = "Asia/Karachi";
const clip = (v, n) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

async function activeDay(userId, { platform, appVersion } = {}) {
  if (!userId) return;
  try {
    const { UserActiveDay } = require("../models");
    const day = moment.tz(PKT).format("YYYY-MM-DD");
    const [row, created] = await UserActiveDay.findOrCreate({
      where: { userId, day },
      defaults: { platform: clip(platform, 10), appVersion: clip(appVersion, 20) },
    });
    if (!created) {
      row.opens = (row.opens || 0) + 1;
      if (platform) row.platform = clip(platform, 10);
      if (appVersion) row.appVersion = clip(appVersion, 20);
      await row.save();
    }
  } catch (e) {
    console.error("[growth] activeDay:", e.message);
  }
}

async function loggedIn(user, method) {
  if (!user) return;
  try {
    await user.update({
      lastLoginAt: new Date(),
      loginCount: (Number(user.loginCount) || 0) + 1,
    });
  } catch (e) {
    console.error("[growth] loggedIn:", e.message);
  }
  activeDay(user.id);
}

const METHODS = ["email", "google", "apple", "phone"];
function signupInfo(body = {}) {
  const m = String(body.signupMethod || "").toLowerCase();
  return {
    signupMethod: METHODS.includes(m) ? m : "email",
    signupSource: clip(body.signupSource || body.utmSource, 40) || "organic",
    signupCampaign: clip(body.signupCampaign || body.utmCampaign, 80),
  };
}

module.exports = { activeDay, loggedIn, signupInfo };
