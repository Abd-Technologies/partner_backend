const moment = require("moment-timezone");
const Redis = require("ioredis");
const { Op } = require("sequelize");
const { ClassAttendance, Plan, Slot, Time, User, UserPlan } = require("../models");
const sendNotification = require("./notification");

const redis = new Redis();
const DEFAULT_TZ = "Asia/Karachi";

function asTimestamp(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

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
      order: [["end", "DESC"]],
    });
    if (!slots.length) continue;

    const lastEndedSlot = slots.find((slot) => {
      const end = asTimestamp(slot.end);
      return end != null && now.valueOf() > end + 30 * 60 * 1000;
    });
    if (!lastEndedSlot) continue;

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
