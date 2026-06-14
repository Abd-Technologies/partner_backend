const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { ClassPresence, Slot } = require("../../models");
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
      presence.lastSeenAt = now;
      await presence.save();
    } else {
      presence = await ClassPresence.create({
        userId,
        slotId,
        meetingNumber: body.meetingNumber ? String(body.meetingNumber) : null,
        source: body.source ? String(body.source) : "zoom_native",
        joinedAt: now,
        lastSeenAt: now,
      });
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

    const trialResult = await markTrialAttendanceIfEligible({
      userId,
      slotId,
      durationSeconds,
      attendedAt: presence.leftAt,
    });

    if (trialResult.marked && !presence.attendanceMarkedAt) {
      presence.attendanceMarkedAt = now;
    }

    await presence.save();

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
