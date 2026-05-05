const ApiResponse = require("../../helper/ApiResponse");
const { TrialJourney, TrialToken, Slot, sequelize } = require("../../models");

const TOKEN_STATUSES = {
  ISSUED: "issued",
  USED: "used",
  EXPIRED: "expired",
  REVOKED: "revoked",
};

const DAY_KEYS = {
  1: {
    slotId: "day1SlotId",
    bookedAt: "day1BookedAt",
    attendedAt: "day1AttendedAt",
    attendedMinutes: "day1AttendedMinutes",
  },
  2: {
    slotId: "day2SlotId",
    bookedAt: "day2BookedAt",
    attendedAt: "day2AttendedAt",
    attendedMinutes: "day2AttendedMinutes",
  },
  3: {
    slotId: "day3SlotId",
    bookedAt: "day3BookedAt",
    attendedAt: "day3AttendedAt",
    attendedMinutes: "day3AttendedMinutes",
  },
};

function isExpired(tokenRow) {
  return !!(tokenRow && tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date());
}

function computeState(journey) {
  if (journey.convertedAt) return "converted";
  if (journey.day3AttendedAt) return "day3_attended";
  if (journey.day3BookedAt) return "day3_booked";
  if (journey.day2AttendedAt) return "day2_attended";
  if (journey.day2BookedAt) return "day2_booked";
  if (journey.day1AttendedAt) return "day1_attended";
  if (journey.day1BookedAt) return "day1_booked";
  if (journey.startedAt) return "trial_started";
  if (journey.tokenValidatedAt) return "token_validated";
  return "trial_started";
}

function computeNextBookableDay(journey) {
  if (!journey.day1BookedAt) return 1;
  if (journey.day1BookedAt && !journey.day1AttendedAt) return null;
  if (!journey.day2BookedAt) return 2;
  if (journey.day2BookedAt && !journey.day2AttendedAt) return null;
  if (!journey.day3BookedAt) return 3;
  return null;
}

function serializeJourney(journey) {
  if (!journey) return null;

  const state = computeState(journey);
  const nextBookableDay = computeNextBookableDay(journey);

  return {
    state,
    nextBookableDay,
    tokenValidatedAt: journey.tokenValidatedAt,
    startedAt: journey.startedAt,
    day1SlotId: journey.day1SlotId,
    day1BookedAt: journey.day1BookedAt,
    day1AttendedAt: journey.day1AttendedAt,
    day1AttendedMinutes: journey.day1AttendedMinutes,
    day2SlotId: journey.day2SlotId,
    day2BookedAt: journey.day2BookedAt,
    day2AttendedAt: journey.day2AttendedAt,
    day2AttendedMinutes: journey.day2AttendedMinutes,
    day3SlotId: journey.day3SlotId,
    day3BookedAt: journey.day3BookedAt,
    day3AttendedAt: journey.day3AttendedAt,
    day3AttendedMinutes: journey.day3AttendedMinutes,
    convertedAt: journey.convertedAt,
  };
}

async function persistDerivedState(journey, options = {}) {
  journey.state = computeState(journey);
  journey.nextBookableDay = computeNextBookableDay(journey);
  await journey.save(options);
  return journey;
}

async function getJourneyForUser(userId) {
  return TrialJourney.findOne({
    where: { userId },
  });
}

async function getValidTokenOrError(token) {
  if (!token || typeof token !== "string" || token.trim() === "") {
    return { error: "Trial token is required", tokenRow: null };
  }

  const tokenRow = await TrialToken.findOne({ where: { token: token.trim() } });
  if (!tokenRow) {
    return { error: "Invalid trial token", tokenRow: null };
  }
  if (tokenRow.status === TOKEN_STATUSES.REVOKED) {
    return { error: "Trial token has been revoked", tokenRow: null };
  }
  if (isExpired(tokenRow)) {
    if (tokenRow.status !== TOKEN_STATUSES.EXPIRED) {
      tokenRow.status = TOKEN_STATUSES.EXPIRED;
      await tokenRow.save();
    }
    return { error: "Trial token has expired", tokenRow: null };
  }
  if (
    tokenRow.status === TOKEN_STATUSES.USED &&
    tokenRow.usedByUserId != null
  ) {
    return { error: "Trial token has already been used", tokenRow: null };
  }

  return { error: null, tokenRow };
}

exports.validateToken = async (req, res) => {
  const { token } = req.body;
  const { error, tokenRow } = await getValidTokenOrError(token);
  if (error) {
    return res.json(ApiResponse("0", error, {}));
  }

  const journey = {
    state: "token_validated",
    nextBookableDay: 1,
    tokenValidatedAt: new Date(),
    startedAt: null,
    day1SlotId: null,
    day1BookedAt: null,
    day1AttendedAt: null,
    day1AttendedMinutes: null,
    day2SlotId: null,
    day2BookedAt: null,
    day2AttendedAt: null,
    day2AttendedMinutes: null,
    day3SlotId: null,
    day3BookedAt: null,
    day3AttendedAt: null,
    day3AttendedMinutes: null,
    convertedAt: null,
    trialTokenId: tokenRow.id,
  };

  return res.json(ApiResponse("1", "Trial token is valid", { journey }));
};

exports.startTrial = async (req, res) => {
  const userId = req.user && req.user.id;
  const incomingToken = (req.body && req.body.token) || "";

  if (!userId) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const transaction = await sequelize.transaction();
  try {
    let journey = await TrialJourney.findOne({
      where: { userId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    let tokenRow = null;
    if (incomingToken.trim()) {
      const tokenResult = await getValidTokenOrError(incomingToken);
      if (tokenResult.error) {
        await transaction.rollback();
        return res.json(ApiResponse("0", tokenResult.error, {}));
      }
      tokenRow = await TrialToken.findOne({
        where: { id: tokenResult.tokenRow.id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
    }

    if (!journey) {
      journey = await TrialJourney.create(
        {
          userId,
          trialTokenId: tokenRow ? tokenRow.id : null,
          tokenValidatedAt: tokenRow ? new Date() : null,
          startedAt: new Date(),
          state: "trial_started",
          nextBookableDay: 1,
        },
        { transaction }
      );
    } else {
      if (!journey.startedAt) {
        journey.startedAt = new Date();
      }
      if (tokenRow && !journey.trialTokenId) {
        journey.trialTokenId = tokenRow.id;
      }
      if (tokenRow && !journey.tokenValidatedAt) {
        journey.tokenValidatedAt = new Date();
      }
      await persistDerivedState(journey, { transaction });
    }

    if (tokenRow) {
      tokenRow.usedAt = new Date();
      tokenRow.usedByUserId = userId;
      tokenRow.status = TOKEN_STATUSES.USED;
      await tokenRow.save({ transaction });
    }

    await persistDerivedState(journey, { transaction });
    await transaction.commit();

    return res.json(
      ApiResponse("1", "Trial started", { journey: serializeJourney(journey) })
    );
  } catch (error) {
    await transaction.rollback();
    return res.json(ApiResponse("0", error.message || error.toString(), {}));
  }
};

exports.getMyTrial = async (req, res) => {
  const userId = req.user && req.user.id;
  if (!userId) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const journey = await getJourneyForUser(userId);
  if (!journey) {
    return res.json(ApiResponse("1", "No active trial", { journey: null }));
  }

  await persistDerivedState(journey);
  return res.json(
    ApiResponse("1", "Trial loaded", { journey: serializeJourney(journey) })
  );
};

exports.bookDay = async (req, res) => {
  const userId = req.user && req.user.id;
  const day = Number(req.body && req.body.day);
  const slotId = Number(req.body && req.body.slotId);

  if (!userId) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }
  if (!DAY_KEYS[day] || !slotId) {
    return res.json(ApiResponse("0", "Valid day and slotId are required", {}));
  }

  const journey = await getJourneyForUser(userId);
  if (!journey) {
    return res.json(ApiResponse("0", "No active trial", {}));
  }

  await persistDerivedState(journey);
  if (journey.nextBookableDay !== day) {
    return res.json(
      ApiResponse(
        "0",
        `Day ${day} cannot be booked right now`,
        { journey: serializeJourney(journey) }
      )
    );
  }

  const slot = await Slot.findOne({ where: { id: slotId } });
  if (!slot) {
    return res.json(ApiResponse("0", "Selected slot does not exist", {}));
  }

  const keys = DAY_KEYS[day];
  journey[keys.slotId] = slotId;
  journey[keys.bookedAt] = new Date();
  await persistDerivedState(journey);

  return res.json(
    ApiResponse("1", `Day ${day} booked successfully`, {
      journey: serializeJourney(journey),
    })
  );
};

exports.markAttendance = async (req, res) => {
  const userId = req.user && req.user.id;
  const day = Number(req.body && req.body.day);
  const attendedMinutes = Math.max(
    0,
    Number(req.body && req.body.attendedMinutes) || 0
  );

  if (!userId) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }
  if (!DAY_KEYS[day]) {
    return res.json(ApiResponse("0", "Valid day is required", {}));
  }

  const journey = await getJourneyForUser(userId);
  if (!journey) {
    return res.json(ApiResponse("0", "No active trial", {}));
  }

  const keys = DAY_KEYS[day];
  if (!journey[keys.bookedAt]) {
    return res.json(ApiResponse("0", `Day ${day} is not booked yet`, {}));
  }
  if (journey[keys.attendedAt]) {
    return res.json(
      ApiResponse("0", `Attendance for day ${day} is already marked`, {
        journey: serializeJourney(journey),
      })
    );
  }

  journey[keys.attendedAt] = new Date();
  journey[keys.attendedMinutes] = attendedMinutes;
  await persistDerivedState(journey);

  return res.json(
    ApiResponse("1", "Attendance marked", {
      journey: serializeJourney(journey),
    })
  );
};

exports.convert = async (req, res) => {
  const userId = req.user && req.user.id;
  if (!userId) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const journey = await getJourneyForUser(userId);
  if (!journey) {
    return res.json(ApiResponse("0", "No active trial", {}));
  }
  if (!journey.day3AttendedAt) {
    return res.json(
      ApiResponse("0", "Trial conversion is only available after day 3 attendance", {})
    );
  }
  if (!journey.convertedAt) {
    journey.convertedAt = new Date();
  }
  await persistDerivedState(journey);

  return res.json(
    ApiResponse("1", "Trial completed", {
      journey: serializeJourney(journey),
    })
  );
};
