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
async function alreadyNotified(userId, slotId, reminderType, slotEnd) {
  const key = `notified:${userId}:${slotId}:${reminderType}`;
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
 * 🔹 Decide which upcoming class reminder to send.
 * Cron runs every 3 minutes, so each window is 3 minutes wide.
 */
function pickClassReminder(slotsToday, nowTimestamp) {
  if (!slotsToday || slotsToday.length === 0) return null;

  for (const slot of slotsToday) {
    const minutesUntilStart = (slot.start - nowTimestamp) / (60 * 1000);

    if (minutesUntilStart <= 45 && minutesUntilStart > 42) {
      return {
        slot,
        reminderType: "classPrep",
        title: "Class Reminder",
        body: `Your class "${slot.description}" starts in 45 minutes.`,
      };
    }

    if (minutesUntilStart <= 10 && minutesUntilStart > 7) {
      return {
        slot,
        reminderType: "classStart",
        title: "Upcoming Class",
        body: `Your class "${slot.description}" is starting soon!`,
      };
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
      const reminder = pickClassReminder(slotsToday, nowTimestamp);

      if (!reminder) continue;

      if (await alreadyNotified(user.id, reminder.slot.id, reminder.reminderType, reminder.slot.end)) {
        continue; // avoid duplicate
      }

      const trainer = await User.findOne({
        attributes: ['id', 'firstName', 'lastName', 'email'],
        where: { id: reminder.slot.trainerId },
      });

      const notification = {
        title: reminder.title,
        body: reminder.body,
      };

      const dataPayload = {
        type: reminder.reminderType,
        upcomingSlot: JSON.stringify(reminder.slot),
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
    const reminder = pickClassReminder(slotsToday, nowTimestamp);

    if (!reminder) return null;

  //  if (await alreadyNotified(user.id, reminder.slot.id, reminder.reminderType, reminder.slot.end)) {
   //   return null; // already sent
   // }

    const trainer = await User.findOne({
      attributes: ['id', 'firstName', 'lastName', 'email'],
      where: { id: reminder.slot.trainerId },
    });



    const dataPayload = {
      type: reminder.reminderType,
      upcomingSlot: JSON.stringify(reminder.slot),
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
