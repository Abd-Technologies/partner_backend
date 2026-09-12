'use strict';

/**
 * Admin overrides for the 3-day TrialJourney system.
 *
 * These endpoints bypass the normal user-facing guards and are only accessible
 * to admins (validateToken + validateAdmin middleware applied in the router).
 */

const ApiResponse = require('../../helper/ApiResponse');
const { TrialJourney } = require('../../models');
const { computeState, computeNextBookableDay } = require('../../helper/trialState');

const DAY_KEYS = {
  1: { bookedAt: 'day1BookedAt', attendedAt: 'day1AttendedAt', attendedMinutes: 'day1AttendedMinutes' },
  2: { bookedAt: 'day2BookedAt', attendedAt: 'day2AttendedAt', attendedMinutes: 'day2AttendedMinutes' },
  3: { bookedAt: 'day3BookedAt', attendedAt: 'day3AttendedAt', attendedMinutes: 'day3AttendedMinutes' },
};

/**
 * POST /admin/trial/force-attendance
 *
 * Marks a trial day as attended for a user who is stuck in the
 * "booked but never attended" deadlock — e.g. the user's app crashed or lost
 * network before the /attendance/presence/leave API fired, so durationSeconds
 * was never recorded and the automatic attendance mark never ran.
 *
 * Body: { userId: number, day: 1|2|3 }
 *
 * Bypasses the 10-minute minimum duration requirement.
 * Sets attendedMinutes to 0 so the record is honest about the override.
 */
exports.forceAttendance = async (req, res) => {
  const adminUser = req.user;
  const userId = Number(req.body && req.body.userId);
  const day    = Number(req.body && req.body.day);

  if (!userId || !DAY_KEYS[day]) {
    return res.json(ApiResponse('0', 'Valid userId and day (1, 2, or 3) are required', {}));
  }

  const journey = await TrialJourney.findOne({ where: { userId } });
  if (!journey) {
    return res.json(ApiResponse('0', `No TrialJourney found for userId ${userId}`, {}));
  }

  const keys = DAY_KEYS[day];

  if (!journey[keys.bookedAt]) {
    return res.json(
      ApiResponse('0', `Day ${day} has not been booked yet for this user — cannot force-attend`, {})
    );
  }
  if (journey[keys.attendedAt]) {
    return res.json(
      ApiResponse('0', `Day ${day} attendance is already marked for this user`, {
        attendedAt: journey[keys.attendedAt],
      })
    );
  }

  journey[keys.attendedAt]    = new Date();
  journey[keys.attendedMinutes] = 0; // 0 = admin override, not real attendance duration
  journey.state                = computeState(journey);
  journey.nextBookableDay      = computeNextBookableDay(journey);
  await journey.save();

  console.log(
    `[trial-admin] Admin ${adminUser?.id} force-marked day ${day} attendance for userId ${userId}`
  );

  return res.json(
    ApiResponse('1', `Day ${day} attendance force-marked for userId ${userId}`, {
      userId,
      day,
      attendedAt:      journey[keys.attendedAt],
      nextBookableDay: journey.nextBookableDay,
      state:           journey.state,
    })
  );
};
