const moment = require("moment-timezone");
const Redis = require("ioredis");
const { Op } = require("sequelize");
const { ClassAttendance, Plan, Slot, Time, User, UserPlan } = require("../models");
const sendNotification = require("./notification");
const { CANONICAL_TZ, parseEndAsUtc } = require("./timeFormats");

const redis = new Redis();
const DEFAULT_TZ = "Asia/Karachi";

async function alreadySent(userId, dateKey) {
  const key = `missedRecovery:${userId}:${dateKey}`;
  const exists = await redis.get(key);
  if (exists) return true;

  await redis.set(key, "1", "EX", 60 * 60 * 36);
  return false;
}

async function sendMissedSessionRecovery() {
  const userPlans = await UserPlan.findAll({
    where: {
      status: true,
      [Op.or]: [
        { expireDate: null },
        { expireDate: { [Op.gte]: new Date() } },
      ],
    },
    include: [
      { model: User, attributes: ["id", "deviceToken", "timeZone"] },
      {
        model: Plan,
        attributes: ["CategoryId", "title"],
        where: { CategoryId: { [Op.or]: [2, 3] } },
      },
    ],
  });

  let sent = 0;

  for (const userPlan of userPlans) {
    const user = userPlan.User;
    if (!user?.deviceToken) continue;

    const now = moment().tz(user.timeZone || DEFAULT_TZ);
    const dateKey = now.format("YYYY-MM-DD");
    if (await alreadySent(user.id, dateKey)) continue;

    const attendance = await ClassAttendance.findOne({
      where: {
        user_id: user.id,
        attended_at: dateKey,
      },
    });
    if (attendance) continue;

    const timeRecord = await Time.findOne({
      where: { day: now.format("dddd") },
      attributes: ["id"],
    });
    if (!timeRecord) continue;

    const slots = await Slot.findAll({
      attributes: ["id", "end", "description"],
      where: { TimeId: timeRecord.id },
    });
    if (!slots.length) continue;

    // Slot.end is a wall-clock string that can be in any of three historical
    // formats (millisecond timestamp, 24h UTC "HH:mm", or the current
    // canonical 12h "h:mm AM/PM" PKT-local — see helper/timeFormats.js).
    // Sorting or comparing it as a plain string/number is unreliable
    // ("10:00 AM" sorts before "9:00 AM" alphabetically, and Number() on
    // any of the AM/PM values is NaN). Parse every slot to a real UTC
    // instant with the same helper autoEndSessions.js already uses
    // correctly, anchored to today in PKT (the timezone the canonical
    // data is stored in), then pick whichever slot actually ends last.
    const todayPkt = moment.tz(CANONICAL_TZ);
    let lastEndedSlot = null;
    let lastEnd = null;
    for (const slot of slots) {
      const endUtc = parseEndAsUtc(slot.end, todayPkt);
      if (!endUtc) continue;
      const endMs = endUtc.valueOf();
      if (lastEnd === null || endMs > lastEnd) {
        lastEnd = endMs;
        lastEndedSlot = slot;
      }
    }
    // Only send after every class is done — if the final slot hasn't cleared
    // its 30-min buffer yet, there are still classes the user could attend.
    if (!lastEndedSlot || lastEnd === null || now.valueOf() <= lastEnd + 30 * 60 * 1000) continue;

    await sendNotification(
      [user.deviceToken],
      {
        title: "Missed Session",
        body: "No worries if today got busy. Open FitHer to get back on track with your next session.",
      },
      {
        type: "missedRecovery",
        date: dateKey,
        slotId: String(lastEndedSlot.id),
      }
    );
    sent += 1;
  }

  return sent;
}

module.exports = { sendMissedSessionRecovery };
