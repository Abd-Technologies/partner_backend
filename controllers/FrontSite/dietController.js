const { TimeDietition, SlotDiet, Plan, UserPlan, User, Appointment, sequelize } = require("../../models");
const axios = require('axios');
const ApiResponse = require("../../helper/ApiResponse");
const { Op } = require("sequelize");

const NUTRITIONIX_APP_ID = "6e3756a6";
const NUTRITIONIX_APP_KEY = "467773c332062e1af5bef60d027c49cc";
const SPOONACULAR_API_KEY="a2291fd5db7543429f91495c0654f28f"

exports.getAllDietTimes = async (req, res, next) => {
  try {
    const dietTimes = await TimeDietition.findAll({
      attributes: ["id", "day"], // Only fetch 'id' and 'day' columns from DietTime
    });
    const response = ApiResponse("1", "Diet Times", { dietTimes: dietTimes });
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.toString(), {});
    return res.json(response);
  }
};
exports.getAllSlotsOfDay = async (req, res, next) => {
  try {
    const { dietitionId, dayId } = req.body;
    const slots = await SlotDiet.findAll({
      where: { dietitionId: dietitionId, TimeDietitionId: dayId },
    });
    const response = ApiResponse("1", "Diet Times", { slots: slots });
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.toString(), {});
    return res.json(response);
  }
};
// Canonical slot wall-clock format — "h:mm AM" / "h:mm PM" PKT-local.
// Must match helper/timeFormats.js parseEndAsUtc so the auto-end cron
// can read what we write here.
const RE_12H_AMPM = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/;

function parseSlotTimeToMinutes(s) {
  if (typeof s !== "string") return null;
  const m = s.trim().match(RE_12H_AMPM);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const isPm = m[3].toUpperCase() === "PM";
  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return null;
  if (hours === 12) hours = isPm ? 12 : 0;
  else if (isPm) hours += 12;
  return hours * 60 + minutes;
}

exports.addOrUpdateDaySlot = async (req, res, next) => {
  // Bug 6 fix: dietitionId comes from the authenticated token, never
  // the request body. Without this a logged-in dietitian could pass
  // someone else's id and overwrite their slots.
  const dietitionId = req.user && req.user.id;
  const { dayId, slotsList } = req.body;

  if (!dietitionId) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }
  if (!dayId || !Array.isArray(slotsList)) {
    return res.json(ApiResponse("0", "dayId and slotsList[] are required", {}));
  }

  // Bug 8: format + range validation. Reject the whole batch on the
  // first invalid row so we never half-write a corrupt set. Inversion
  // and 12+ hour rows (the kind we cleaned up today as ids 37/41)
  // would have been caught here.
  const parsed = [];
  for (let i = 0; i < slotsList.length; i++) {
    const el = slotsList[i];
    const startMin = parseSlotTimeToMinutes(el.start);
    const endMin = parseSlotTimeToMinutes(el.end);
    if (startMin == null || endMin == null) {
      return res.json(
        ApiResponse(
          "0",
          `Slot[${i}] has invalid time format. Expected "h:mm AM/PM" PKT-local.`,
          {}
        )
      );
    }
    if (endMin <= startMin) {
      return res.json(
        ApiResponse("0", `Slot[${i}] end time must be after start time.`, {})
      );
    }
    parsed.push({ ...el, startMin, endMin });
  }

  // Overlap check across the batch — sort by start, ensure adjacent
  // ranges don't intersect. O(n log n).
  const sorted = [...parsed].sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMin < sorted[i - 1].endMin) {
      return res.json(
        ApiResponse(
          "0",
          `Slots overlap: "${sorted[i - 1].start} - ${sorted[i - 1].end}" and "${sorted[i].start} - ${sorted[i].end}".`,
          {}
        )
      );
    }
  }

  // Bug 10: read existing → mutate → cleanup must be one transaction so
  // two concurrent saves can't interleave and leave a corrupt set.
  const t = await sequelize.transaction();
  try {
    const existingSlots = await SlotDiet.findAll({
      where: { dietitionId, TimeDietitionId: dayId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const existingSlotMap = new Map(existingSlots.map((s) => [s.id, s]));
    const incomingIds = new Set(
      slotsList.map((el) => el.id).filter((id) => id != null)
    );

    // Bug 5: refuse to delete a slot that has live appointments
    // (pending / confirmed / In Progress). Hard delete would orphan
    // those rows' timeSlotId — exactly the dangling-FK problem we
    // had to clean up today.
    const slotsToRemove = existingSlots.filter((s) => !incomingIds.has(s.id));
    if (slotsToRemove.length > 0) {
      const liveAppts = await Appointment.findAll({
        where: {
          timeSlotId: { [Op.in]: slotsToRemove.map((s) => s.id) },
          status: { [Op.in]: ["pending", "confirmed", "In Progress"] },
        },
        attributes: ["id", "timeSlotId", "status"],
        transaction: t,
      });
      if (liveAppts.length > 0) {
        await t.rollback();
        return res.json(
          ApiResponse(
            "0",
            `Cannot delete slot(s) with live appointments. Cancel ${liveAppts.length} appointment(s) first.`,
            { blockingAppointments: liveAppts }
          )
        );
      }
    }

    for (const element of slotsList) {
      // Bug 9: == null catches both null and undefined; === null missed
      // the undefined case and silently dropped new-slot creates.
      if (element.id == null) {
        await SlotDiet.create(
          {
            start: element.start,
            end: element.end,
            dietitionId,
            TimeDietitionId: dayId,
          },
          { transaction: t }
        );
      } else if (existingSlotMap.has(element.id)) {
        const slotToUpdate = existingSlotMap.get(element.id);
        slotToUpdate.start = element.start;
        slotToUpdate.end = element.end;
        await slotToUpdate.save({ transaction: t });
      }
      // ids that don't belong to this dietitian+day are silently
      // ignored — they could be a stale client cache or a tampered id.
    }

    for (const slot of slotsToRemove) {
      await slot.destroy({ transaction: t });
    }

    await t.commit();
    return res.json(ApiResponse("1", "Slot updated successfully", {}));
  } catch (error) {
    await t.rollback();
    return res.json(ApiResponse("0", error.toString(), {}));
  }
};
exports.getAllClients = async (req, res, next) => {
  try {
    const { id } = req.params;
    // Bug 6: a dietitian can only see their own clients. The :id URL
    // param is preserved for backward-compat with existing Flutter
    // calls but the server enforces it must equal req.user.id.
    if (!req.user || Number(id) !== Number(req.user.id)) {
      return res.json(ApiResponse("0", "Forbidden", {}));
    }
    // findAll, not findOne — a dietitian may own multiple plans.
    // Prior version returned only the clients of whichever plan
    // Sequelize happened to return first.
    const plans = await Plan.findAll({
      where: { dietitianId: id },
      attributes: ["id"],
    });

    if (plans.length === 0) {
      return res.json(ApiResponse("0", "No Plan assigned to you yet", {}));
    }

    const planIds = plans.map((p) => p.id);
    const clients = await UserPlan.findAll({
      where: { PlanId: { [Op.in]: planIds } },
      attributes: ["id", "buyingDate", "expireDate", "PlanId"],
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
      order: [["buyingDate", "DESC"]],
    });

    return res.json(ApiResponse("1", "Diet Client", { cliets: clients }));
  } catch (error) {
    const response = ApiResponse("0", error.toString(), {});
    return res.json(response);
  }
};





exports.checkNutrition = async (req, res) => {
  try {
    const userId = req.params.id; // User ID from URL param
    const { foodName } = req.body;

    // Bug 6: prevent a logged-in user from incrementing someone else's
    // calorie counter via the :id param. The :id must match the token.
    if (!req.user || Number(userId) !== Number(req.user.id)) {
      return res.status(200).json(ApiResponse("0", "Forbidden", {}));
    }

    // 1. Check user limit
    const user = await User.findOne({ where: { id: userId } });
    if (!user) return res.status(404).json(ApiResponse("0", "User not found", {}));

    if (user.caloriesCounter >= 3) {
      return res.json(ApiResponse("0", "Your daily limit is exceeded. Check again tomorrow.", {}));
    }

    // 2. Call Spoonacular API
    const spoonacularRes = await axios.get(
      `https://api.spoonacular.com/recipes/guessNutrition`,
      {
        params: {
          title: foodName,
          apiKey:SPOONACULAR_API_KEY,
        },
      }
    );

    const data = spoonacularRes.data;

    if (!data || !data.calories) {
      return res.json(ApiResponse("0", "No nutrition info found for this item.", {}));
    }

    // 3. Increment the user counter
    user.caloriesCounter = (user.caloriesCounter || 0) + 1;
    await user.save();

    // 4. Format response
    const responseData = {
      name: foodName,
      calories: { amount: data.calories.value || 0, unit: data.calories.unit },
      protein: { amount: data.protein.value || 0, unit: data.protein.unit },
      fat: { amount: data.fat.value || 0, unit: data.fat.unit },
      carbs: { amount: data.carbs.value || 0, unit: data.carbs.unit },
      remainingChecks: 3 - user.caloriesCounter,
    };

    return res.json(ApiResponse("1", "Nutrition fetched successfully", responseData));

  } catch (error) {
    console.error(error.response?.data || error.message);
    return res.status(500).json(
      ApiResponse("0", "Something went wrong", { error: error.message })
    );
  }
};


