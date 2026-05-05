const { Slot, Time, User, UserPlan, Plan, FreeTrailUsers, FreeTrailUsersSlots } = require('../models');
const { Op } = require('sequelize');
const Queue = require("bull");
const moment = require('moment-timezone');
const Redis = require("ioredis");

const notificationQueue = new Queue("notificationQueue", {
  redis: { host: "127.0.0.1", port: 6379 },
});
const redis = new Redis();

/**
 * 🔹 Prevent duplicate notifications (per user & slot)
 */
async function alreadyNotified(userId, slotId, slotEnd) {
  const key = `notified:${userId}:${slotId}`;
  const exists = await redis.get(key);
  if (exists) return true;

  // expire key after slot ends + 10 min buffer
  const ttlSeconds = Math.ceil((slotEnd - Date.now()) / 1000) + 600;
  await redis.set(key, "1", "EX", ttlSeconds);
  return false;
}

/**
 * 🔹 Helper: Get all today's slots for a user (sorted by start time)
 */
async function getTodaySlotsForUser(user, timeRecord, isFreeTrial) {
  if (isFreeTrial) {
    const freeTrialSlots = await FreeTrailUsers.findOne({
      where: { freeTrialUser: user.id },
      include: [
        {
          model: FreeTrailUsersSlots,
          as: "freeUserSlots",
          include: [
            {
              model: Slot,
              as: "slot",
              attributes: ['id', 'start', 'end', 'level', 'type', 'description', 'trainerId', 'status'],
              where: { TimeId: timeRecord.id },
            },
          ],
        },
      ],
    });

    if (freeTrialSlots && freeTrialSlots.freeUserSlots.length > 0) {
      return freeTrialSlots.freeUserSlots
        .map(s => s.slot)
        .filter(Boolean)
        .sort((a, b) => a.start - b.start);
    }
    return [];
  } else {
    return await Slot.findAll({
      attributes: ['id', 'start', 'end', 'level', 'type', 'description', 'trainerId', 'status'],
      where: { TimeId: timeRecord.id },
      order: [['start', 'ASC']],
    });
  }
}

/**
 * 🔹 Decide which upcoming slot to notify
 * Rules:
 * 1. First slot → 20 minutes before start.
 * 2. Next slots → right after previous ends.
 */
function pickNextSlot(slotsToday, nowTimestamp) {
  if (!slotsToday || slotsToday.length === 0) return null;

  const firstSlot = slotsToday[0];
  const startMinus20 = firstSlot.start - 20 * 60 * 1000;

  // Case 1: First slot → notify 20 minutes before
  if (nowTimestamp >= startMinus20 && nowTimestamp < firstSlot.start) {
    return firstSlot;
  }

  // Case 2: If a slot just ended → notify next one
  for (let i = 0; i < slotsToday.length - 1; i++) {
    const currentSlot = slotsToday[i];
    const nextSlot = slotsToday[i + 1];

    if (nowTimestamp > currentSlot.end && nowTimestamp < nextSlot.start) {
      return nextSlot;
    }
  }

  return null;
}

/**
 * 🔹 Send notifications to ALL users
 */
async function sendUpcomingSlotNotificationsPerUser() {
  try {
    const userPlans = await UserPlan.findAll({
      include: [
        { model: User, attributes: ['id', 'deviceToken', 'timeZone'] },
        {
          model: Plan,
          attributes: ['CategoryId', 'title'],
          where: { CategoryId: { [Op.or]: [2, 3] } },
        },
      ],
    });

    for (const userPlan of userPlans) {
      const user = userPlan.User;
      if (!user || !user.deviceToken || !user.timeZone) continue;

      const userMoment = moment().tz(user.timeZone);
      const currentDay = userMoment.format('dddd');
      const nowTimestamp = userMoment.valueOf();

      const timeRecord = await Time.findOne({ where: { day: currentDay }, attributes: ['id'] });
      if (!timeRecord) continue;

      const slotsToday = await getTodaySlotsForUser(user, timeRecord, userPlan.Plan.title === "Free Trial");
      const upcomingSlot = pickNextSlot(slotsToday, nowTimestamp);

      if (!upcomingSlot) continue;

      if (await alreadyNotified(user.id, upcomingSlot.id, upcomingSlot.end)) {
        continue; // avoid duplicate
      }

      const trainer = await User.findOne({
        attributes: ['id', 'firstName', 'lastName', 'email'],
        where: { id: upcomingSlot.trainerId },
      });

      const notification = {
        title: 'Upcoming Class',
        body: `Your class "${upcomingSlot.description}" is starting soon!`,
      };

      const dataPayload = {
        upcomingSlot: JSON.stringify(upcomingSlot),
        trainer: JSON.stringify(trainer ?? {}),
      };

      await notificationQueue.add({
        title: notification.title,
        body: notification.body,
        data: dataPayload,
        deviceTokens: [user.deviceToken],
      });

      console.log(`📩 Notification queued for user ${user.id}`);
    }

    console.log("📩 Notifications processed for all users.");
  } catch (error) {
    console.error("❌ Error sending upcoming slot notifications:", error);
  }
}

/**
 * 🔹 Send notification to ONE user
 */
async function sendUpcomingSlotNotificationToUser(userId) {
  try {
    const userPlan = await UserPlan.findOne({
      where: { userId },
      include: [
        { model: User, attributes: ['id', 'deviceToken', 'timeZone'] },
        {
          model: Plan,
          attributes: ['CategoryId', 'title'],
          where: { CategoryId: { [Op.or]: [2, 3] } },
        },
      ],
    });

    if (!userPlan) return null;

    const user = userPlan.User;
    if (!user || !user.deviceToken || !user.timeZone) return null;

    const userMoment = moment().tz(user.timeZone);
    const currentDay = userMoment.format('dddd');
    const nowTimestamp = userMoment.valueOf();

    const timeRecord = await Time.findOne({ where: { day: currentDay }, attributes: ['id'] });
    if (!timeRecord) return null;

    const slotsToday = await getTodaySlotsForUser(user, timeRecord, userPlan.Plan.title === "Free Trial");
    const slot = pickNextSlot(slotsToday, nowTimestamp);

    if (!slot) return null;

  //  if (await alreadyNotified(user.id, slot.id, slot.end)) {
   //   return null; // already sent
   // }

    const trainer = await User.findOne({
      attributes: ['id', 'firstName', 'lastName', 'email'],
      where: { id: slot.trainerId },
    });



    const dataPayload = {
      upcomingSlot: JSON.stringify(slot),
      trainer: JSON.stringify(trainer ?? {}),
    };

    console.log(`📩 Notification ready for user ID ${userId}`);
    return dataPayload ;
  } catch (error) {
    console.error(`❌ Error sending upcoming slot notification for user ID ${userId}:`, error);
    return null;
  }
}

module.exports = {
  sendUpcomingSlotNotificationsPerUser,
  sendUpcomingSlotNotificationToUser,
};
