const { TrialJourney } = require("../models");
// Bug 5 fix: use shared state functions instead of duplicating them here.
const { computeState, computeNextBookableDay } = require("./trialState");

const DEFAULT_MIN_SECONDS = 10 * 60;

function minTrialAttendanceSeconds() {
  const raw = Number(process.env.TRIAL_ATTENDANCE_MIN_SECONDS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return DEFAULT_MIN_SECONDS;
}

function matchingTrialDay(journey, slotId) {
  const normalizedSlotId = Number(slotId);
  const days = [
    {
      day: 1,
      slotIdKey: "day1SlotId",
      attendedAtKey: "day1AttendedAt",
      minutesKey: "day1AttendedMinutes",
    },
    {
      day: 2,
      slotIdKey: "day2SlotId",
      attendedAtKey: "day2AttendedAt",
      minutesKey: "day2AttendedMinutes",
    },
    {
      day: 3,
      slotIdKey: "day3SlotId",
      attendedAtKey: "day3AttendedAt",
      minutesKey: "day3AttendedMinutes",
    },
  ];

  return days.find((item) => Number(journey[item.slotIdKey]) === normalizedSlotId);
}

async function markTrialAttendanceIfEligible({
  userId,
  slotId,
  durationSeconds,
  attendedAt = new Date(),
}) {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  const threshold = minTrialAttendanceSeconds();
  if (seconds < threshold) {
    return {
      marked: false,
      reason: "below_threshold",
      thresholdSeconds: threshold,
    };
  }

  const journey = await TrialJourney.findOne({ where: { userId } });
  if (!journey) {
    return { marked: false, reason: "no_trial" };
  }
  if (journey.convertedAt) {
    return { marked: false, reason: "already_converted" };
  }

  const match = matchingTrialDay(journey, slotId);
  if (!match) {
    return { marked: false, reason: "slot_not_booked_for_trial" };
  }
  if (journey[match.attendedAtKey]) {
    return {
      marked: false,
      reason: "already_marked",
      day: match.day,
      journey,
    };
  }

  journey[match.attendedAtKey] = attendedAt;
  journey[match.minutesKey] = Math.ceil(seconds / 60);
  journey.state = computeState(journey);
  journey.nextBookableDay = computeNextBookableDay(journey);
  await journey.save();

  return {
    marked: true,
    day: match.day,
    journey,
    thresholdSeconds: threshold,
  };
}

module.exports = {
  markTrialAttendanceIfEligible,
  minTrialAttendanceSeconds,
};
