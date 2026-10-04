/**
 * "Today" in the user's own time zone, so her daily water, feeling and
 * sleep reset at her midnight (not at the server's clock, which may be
 * UTC = 5:00 AM Pakistan time).
 *
 * Uses User.timeZone; falls back to Pakistan time when it's missing or
 * not a real zone. Zones are cached for 5 minutes.
 */
const moment = require("moment-timezone");
const { User } = require("../models");

const DEFAULT_TZ = "Asia/Karachi";
const cache = new Map(); // userId -> { tz, at }

async function userTimeZone(userId) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.tz;
  let tz = DEFAULT_TZ;
  try {
    const u = await User.findByPk(userId, { attributes: ["id", "timeZone"] });
    if (u && u.timeZone && moment.tz.zone(u.timeZone)) tz = u.timeZone;
  } catch (e) {
    // keep default
  }
  cache.set(userId, { tz, at: Date.now() });
  return tz;
}

/** "YYYY-MM-DD" for today in her time zone. */
async function userToday(userId) {
  const tz = await userTimeZone(userId);
  return moment.tz(tz).format("YYYY-MM-DD");
}

module.exports = { userToday, userTimeZone, DEFAULT_TZ };
