const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const moment = require("moment-timezone");
const { ClassPresence, Slot, TrialJourney, UserPlan, Plan } = require("../../models");
const { getTrialDays, getJoinWindowMinutes } = require("../../helper/trialState");
const { activeUserPlanWhere } = require("../../helper/activePackage");
const { parseEndAsUtc } = require("../../helper/timeFormats");

// Free-trial users may only join in the first N minutes of a class
// (TRIAL_JOIN_WINDOW_MINUTES, default 10). Paid workout clients are never
// limited. Returns the minutes late when she's a trial user past the
// window, otherwise null.
async function trialLateMinutes(userId, slot) {
  if (!TrialJourney) return null;
  const journey = await TrialJourney.findOne({
    where: {
      userId,
      convertedAt: null,
      startedAt: { [Op.gte]: moment().subtract(getTrialDays(), "days").toDate() },
    },
    attributes: ["id"],
  });
  if (!journey) return null;
  // Bought a workout / combined package: not a trial user any more.
  const paid = await UserPlan.findOne({
    where: { userId, ...activeUserPlanWhere(), isTrial: { [Op.not]: true } },
    include: [{ model: Plan, attributes: [], where: { CategoryId: { [Op.in]: [2, 3] } } }],
    attributes: ["id"],
  });
  if (paid) return null;
  const todayPkt = moment.tz("Asia/Karachi");
  const startUtc = parseEndAsUtc(slot.start, todayPkt);
  if (!startUtc) return null;
  const window = getJoinWindowMinutes();
  const late = moment.utc().diff(startUtc, "minutes", true);
  if (late <= window) return null;

  // Rejoin rule: she joined THIS class today on time (within the window),
  // so she can come back anytime until it ends (dropped internet, app
  // crash, tapped Leave by mistake). The window only applies to the
  // first join.
  const joinedOnTime = await ClassPresence.findOne({
    where: {
      userId,
      slotId: slot.id,
      joinedAt: {
        [Op.gte]: todayPkt.clone().startOf("day").toDate(),
        [Op.lte]: startUtc.clone().add(window, "minutes").toDate(),
      },
    },
    attributes: ["id"],
  });
  if (joinedOnTime) {
    const endUtc = parseEndAsUtc(slot.end, todayPkt);
    if (!endUtc || moment.utc().isBefore(endUtc)) return null;
  }
  return Math.floor(late);
}

// Total seconds she spent in this class today across all her joins
// (rejoins add up: 8:08-8:15 + 8:20-8:40 = 27 min).
async function secondsInClassToday(userId, slotId, currentId, currentSeconds) {
  const todayStart = moment.tz("Asia/Karachi").startOf("day").toDate();
  const rows = await ClassPresence.findAll({
    where: { userId, slotId, joinedAt: { [Op.gte]: todayStart } },
    attributes: ["id", "durationSeconds"],
  });
  let total = 0;
  for (const r of rows) {
    total += r.id === currentId ? currentSeconds : Number(r.durationSeconds) || 0;
  }
  if (!rows.some((r) => r.id === currentId)) total += currentSeconds;
  return total;
}
const {
  markTrialAttendanceIfEligible,
  minTrialAttendanceSeconds,
} = require("../../helper/trialAttendance");

function serializePresence(row) {
  if (!row) return null;
  const json = row.toJSON ? row.toJSON() : { ...row };
  return {
    id: json.id,
    userId: json.userId,
    slotId: json.slotId,
    meetingNumber: json.meetingNumber,
    source: json.source,
    joinedAt: json.joinedAt,
    lastSeenAt: json.lastSeenAt,
    leftAt: json.leftAt,
    durationSeconds: json.durationSeconds,
    attendanceMarkedAt: json.attendanceMarkedAt,
  };
}

function parseSlotId(body) {
  const slotId = Number(body && body.slotId);
  return Number.isInteger(slotId) && slotId > 0 ? slotId : null;
}

exports.join = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const body = req.body || {};
    const slotId = parseSlotId(body);
    if (!slotId) return res.json(ApiResponse("0", "Valid slotId is required", {}));

    const slot = await Slot.findOne({ where: { id: slotId } });
    if (!slot) return res.json(ApiResponse("0", "Slot not found", {}));

    const now = new Date();
    let presence = await ClassPresence.findOne({
      where: {
        userId,
        slotId,
        leftAt: { [Op.is]: null },
      },
      order: [["joinedAt", "DESC"]],
    });

    if (presence) {
      // Already in the class (e.g. reconnecting): always allowed.
      presence.lastSeenAt = now;
      await presence.save();
    } else {
      const lateBy = await trialLateMinutes(userId, slot);
      if (lateBy != null) {
        console.log(
          `[class-analytics] TRIAL_JOIN_BLOCKED_LATE: userId=${userId} slotId=${slotId} lateBy=${lateBy}m`
        );
        return res.json(
          ApiResponse("0", `Trial classes are joined within the first ${getJoinWindowMinutes()} minutes.`, {
            code: "TRIAL_LATE",
            lateMinutes: lateBy,
            joinWindowMinutes: getJoinWindowMinutes(),
          })
        );
      }
      presence = await ClassPresence.create({
        userId,
        slotId,
        meetingNumber: body.meetingNumber ? String(body.meetingNumber) : null,
        source: body.source ? String(body.source) : "zoom_native",
        joinedAt: now,
        lastSeenAt: now,
      });
      console.log(
        `[class-analytics] USER_JOINED_CLASS: userId=${userId} slotId=${slotId} joinedAt="${now.toISOString()}" scheduledStart="${slot.start}" source="${body.source || 'zoom_native'}"`
      );
    }

    return res.json(
      ApiResponse("1", "Class presence started", {
        presence: serializePresence(presence),
        minTrialAttendanceSeconds: minTrialAttendanceSeconds(),
      })
    );
  } catch (error) {
    return res.json(ApiResponse("0", error.message || error.toString(), {}));
  }
};

exports.leave = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const body = req.body || {};
    const slotId = parseSlotId(body);
    if (!slotId) return res.json(ApiResponse("0", "Valid slotId is required", {}));

    const now = new Date();
    let presence = await ClassPresence.findOne({
      where: {
        userId,
        slotId,
        leftAt: { [Op.is]: null },
      },
      order: [["joinedAt", "DESC"]],
    });

    if (!presence) {
      presence = await ClassPresence.findOne({
        where: { userId, slotId },
        order: [["joinedAt", "DESC"]],
      });
    }

    if (!presence) {
      return res.json(ApiResponse("0", "No class presence found", {}));
    }

    const joinedAt = new Date(presence.joinedAt);
    const durationSeconds = Math.max(
      Number(presence.durationSeconds) || 0,
      Math.floor((now.getTime() - joinedAt.getTime()) / 1000)
    );

    presence.lastSeenAt = now;
    presence.leftAt = presence.leftAt || now;
    presence.durationSeconds = durationSeconds;

    const totalSeconds = await secondsInClassToday(userId, slotId, presence.id, durationSeconds);
    const trialResult = await markTrialAttendanceIfEligible({
      userId,
      slotId,
      durationSeconds: totalSeconds,
      attendedAt: presence.leftAt,
    });

    if (trialResult.marked && !presence.attendanceMarkedAt) {
      presence.attendanceMarkedAt = now;
    }

    await presence.save();

    console.log(
      `[class-analytics] USER_LEFT_CLASS: userId=${userId} slotId=${slotId} durationMinutes=${Math.round(durationSeconds / 60)} durationSeconds=${durationSeconds} leftAt="${now.toISOString()}" trialAttendanceMarked=${trialResult.marked}`
    );

    return res.json(
      ApiResponse("1", "Class presence ended", {
        presence: serializePresence(presence),
        trialAttendance: {
          marked: trialResult.marked,
          reason: trialResult.reason,
          day: trialResult.day,
          thresholdSeconds: trialResult.thresholdSeconds,
        },
      })
    );
  } catch (error) {
    return res.json(ApiResponse("0", error.message || error.toString(), {}));
  }
};
