const { Slot, Time, User, UserPlan, Plan, NotificationPreference, FreeTrailUsers, FreeTrailUsersSlots } = require('../models');
const { Op } = require('sequelize');
const Queue = require("bull");
const moment = require('moment-timezone');
const Redis = require("ioredis");

const notificationQueue = new Queue("notificationQueue", {
  redis: { host: "127.0.0.1", port: 6379 },
});
const redis = new Redis();

/**
 * 🔹 Prevent duplicate notifications per user per slot.
 * Each slot gets exactly one classPrep and one classStart — no more.
 * TTL expires when the slot ends + 10 min buffer so keys clean up automatically.
 */
async function alreadyNotified(userId, slotId, reminderType, slotEnd) {
  const key = `notified:${userId}:${slotId}:${reminderType}`;
  const exists = await redis.get(key);
  if (exists) return true;

  const ttlSeconds = Math.ceil((slotEnd - Date.now()) / 1000) + 600;
  await redis.set(key, "1", "EX", Math.max(ttlSeconds, 60));
  return false;
}

/**
 * 🔹 Filter today's slots to only those falling in the user's preferred
 * time window (set in NotificationPreference.timeBlock).
 *
 * Windows (hour of day in user's local timezone):
 *   morning   →  5:00 – 11:59
 *   afternoon → 12:00 – 16:59
 *   evening   → 17:00 – 20:59
 *   night     → 21:00 – 04:59 (wraps midnight)
 *   all       → no filter (default)
 *
 * With 8 open classes (8 AM → 10 PM) a user who sets timeBlock='evening'
 * only gets notified for 7:30 PM — 2 pushes instead of 16.
 */
const TIME_BLOCK_HOURS = {
  morning:   { start: 6,  end: 11 },
  afternoon: { start: 11, end: 16 },
  evening:   { start: 16, end: 20 },
  night:     { start: 20, end: 29 }, // 20:00 (8 PM) to 05:00 next day (wraps midnight)
};

function filterSlotsByTimeBlock(slots, timeBlock, timeZone) {
  if (!timeBlock || timeBlock === 'all') return slots;
  const window = TIME_BLOCK_HOURS[timeBlock];
  if (!window) return slots;

  return slots.filter(slot => {
    const startMs = Number(slot.start);
    if (!Number.isFinite(startMs)) return false;
    const hour = moment(startMs).tz(timeZone || 'Asia/Karachi').hours();
    // night wraps past midnight: treat hours 0-4 as 24-28
    const h = (timeBlock === 'night' && hour < 5) ? hour + 24 : hour;
    return h >= window.start && h < window.end;
  });
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

    // Batch-fetch timeBlock preferences to avoid N+1 queries.
    // Default 'all' if the user has no preference row yet.
    const userIds = userPlans.map(up => up.User?.id).filter(Boolean);
    const prefs = await NotificationPreference.findAll({
      where: { userId: { [Op.in]: userIds } },
      attributes: ['userId', 'timeBlock'],
    });
    const timeBlockByUserId = new Map(prefs.map(p => [p.userId, p.timeBlock || 'all']));

    for (const userPlan of userPlans) {
      const user = userPlan.User;
      if (!user || !user.deviceToken || !user.timeZone) continue;

      const userMoment = moment().tz(user.timeZone);
      const currentDay = userMoment.format('dddd');
      const nowTimestamp = userMoment.valueOf();

      const timeRecord = await Time.findOne({ where: { day: currentDay }, attributes: ['id'] });
      if (!timeRecord) continue;

      const allSlotsToday = await getTodaySlotsForUser(user, timeRecord, userPlan.Plan.title === "Free Trial");

      // Only notify for classes that fall in the user's preferred time window.
      // A user who sets 'evening' won't be disturbed by 8 AM class reminders.
      const timeBlock = timeBlockByUserId.get(user.id) || 'all';
      const slotsToday = filterSlotsByTimeBlock(allSlotsToday, timeBlock, user.timeZone);

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

/**
 * 🔹 Single source of truth for "who gets notified about slot X".
 *
 * Slots are drop-in, not per-user booked (confirmed: any paid user on a
 * workout/workout+diet plan — Plan.CategoryId 2 or 3 — can join any slot
 * that matches their plan). So the roster for an admin-triggered slot
 * notification (link added, trainer joined, status changed) is:
 *   1. every paid user currently on a CategoryId 2/3 plan, plus
 *   2. any free-trial user explicitly assigned to this exact slot.
 *
 * This mirrors the token lookup already proven correct in
 * sendUpcomingSlotNotificationsPerUser above. AdminController's
 * updateLink / updateTrainerJoin / update_slot_status should call this
 * instead of re-deriving the roster themselves — that duplication (an
 * abandoned copy still sits commented-out in notificationWorker.js) is
 * exactly what let those three call sites drift out of sync and ship
 * with an empty recipient list.
 */
async function getDeviceTokensForSlot(slot) {
  if (!slot || !slot.id) return [];

  try {
    const [paidUserPlans, freeTrialAssignments] = await Promise.all([
      UserPlan.findAll({
        include: [
          { model: User, attributes: ['deviceToken'] },
          {
            model: Plan,
            attributes: ['CategoryId'],
            where: { CategoryId: { [Op.or]: [2, 3] } },
          },
        ],
      }),
      FreeTrailUsersSlots.findAll({
        where: { slotId: slot.id },
        include: [{
          model: FreeTrailUsers,
          as: 'freeUserSlots',
          include: [{ model: User, as: 'freeUserId', attributes: ['deviceToken'] }],
        }],
      }),
    ]);

    const paidTokens = paidUserPlans
      .map(up => up.User?.deviceToken)
      .filter(Boolean);

    const freeTokens = freeTrialAssignments
      .map(a => a.freeUserSlots?.freeUserId?.deviceToken)
      .filter(Boolean);

    // De-dupe — a user could theoretically surface in both queries.
    return Array.from(new Set([...paidTokens, ...freeTokens]));
  } catch (err) {
    console.error('[getDeviceTokensForSlot] roster lookup failed:', err);
    return [];
  }
}

module.exports = {
  sendUpcomingSlotNotificationsPerUser,
  sendUpcomingSlotNotificationToUser,
  getDeviceTokensForSlot,
};
