// Admin controller — classes.
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
const {
  SLOT_WEEKDAY_NAMES,
  SLOT_DEFAULT_TZ,
  parseSlotPartsAdmin,
  slotUtcMomentForDay,
  response,
  ApiResponse,
  Time,
  normalizeSlotTime,
  Slot,
  me,
  User,
  moment,
  getIO,
  notificationQueue,
  UserPlan,
  sendNotification,
  findFrozenActivePlan,
  getDeviceTokensForSlot,
  Category,
  Plan,
  SubCategory,
  Op,
  AssignedPlan,
  FreeTrailUsers,
  FreeTrailUsersSlots,
  TrialJourney,
} = require("./_shared");

// Group an array of Slot rows by the user-local weekday after timezone
// conversion, returning the same shape as the legacy controller emitted.
// `id` is preserved as the original Time.id when all slots in the bucket
// shared one (typical case) — otherwise falls back to the weekday index.
function groupSlotsByLocalWeekday(slots, userTz) {
  const buckets = {};
  for (const slot of slots) {
    if (!slot.Time) continue;
    const local = localizeSlotForUser(slot, userTz);
    const key = local.weekday || slot.Time.day;
    if (!buckets[key]) {
      buckets[key] = {
        id: slot.Time.id,
        day: key,
        slots: [],
        _orderIdx: SLOT_WEEKDAY_NAMES.indexOf(key),
      };
    }
    buckets[key].slots.push({
      id: slot.id,
      start: local.start,
      end: local.end,
      isTrainerJoined: slot.isTrainerJoined,
      joinedUserUID: slot.joinedUserUID,
      type: slot.type,
      level: slot.level,
      status: slot.status,
      description: slot.description,
      trainerLink: slot.trainerLink,
      trainer: slot.User,
    });
  }
  return Object.values(buckets)
    .sort((a, b) => a._orderIdx - b._orderIdx)
    .map(({ _orderIdx, ...rest }) => rest);
}

// Build a slot's display payload converted to the user's timezone.
// Returns { start, end, weekday } where start/end are "hh:mm A" strings
// and weekday is the user-local weekday name (may differ from Time.day if
// the timezone shift crosses midnight).
function localizeSlotForUser(slot, userTz) {
  const tz = userTz || SLOT_DEFAULT_TZ;
  const dayName = slot.Time && slot.Time.day ? slot.Time.day : null;
  const startParts = parseSlotPartsAdmin(slot.start);
  const endParts = parseSlotPartsAdmin(slot.end);

  let startStr = slot.start;
  let endStr = slot.end;
  let weekday = dayName;

  if (dayName && startParts) {
    const startUtc = slotUtcMomentForDay(startParts, dayName);
    if (startUtc) {
      const startLocal = startUtc.clone().tz(tz);
      startStr = startLocal.format("hh:mm A");
      weekday = startLocal.format("dddd");
      if (endParts) {
        // Build end the same way as start — going through
        // slotUtcMomentForDay so that local-AM/PM end values are
        // interpreted in PKT (not as raw UTC hours, which was the
        // pre-fix bug that produced "03:00 AM → 08:50 AM" outputs).
        let endUtc = slotUtcMomentForDay(endParts, dayName);
        if (endUtc && endUtc.isBefore(startUtc)) endUtc.add(1, "day");
        if (endUtc) endStr = endUtc.clone().tz(tz).format("hh:mm A");
      }
    }
  }
  return { start: startStr, end: endStr, weekday };
}

async function add_slots(req, res) {
  try {
    const { times } = req.body;

    // Check if times data is provided
    if (!times || times.length === 0) {
      const response = ApiResponse("0", "No times data provided.", {});
      return res.json(response);
    }

    // Loop through each day object in the times array
    for (const dd of times) {
      // Create a new Time instance
      const newTime = new Time();
      newTime.day = dd.day;
      newTime.status = 1;

      // Save the Time instance and wait for the ID to be generated
      await newTime.save();

      // Loop through each slot in the current day's slots array
      for (const timeSlot of dd.slots) {
        // Normalize incoming start/end into canonical "hh:mm A" PKT.
        // Legacy admin clients sometimes send ms timestamps or 24-hour
        // UTC strings; normalizing here keeps the DB single-format.
        const normalizedStart = normalizeSlotTime(timeSlot.start);
        const normalizedEnd = normalizeSlotTime(timeSlot.end);

        const newSlot = new Slot();
        newSlot.start = normalizedStart ?? timeSlot.start;
        newSlot.end = normalizedEnd ?? timeSlot.end;
        newSlot.TimeId = newTime.id;
        // Same optional workout-details fields as update_slots below --
        // add_slots doesn't assign a trainer yet, but nothing stops the
        // admin from typing the class type/level/description in while
        // building the initial grid, same as update_slots does.
        if (timeSlot.type != null) newSlot.type = timeSlot.type;
        if (timeSlot.level != null) newSlot.level = timeSlot.level;
        if (timeSlot.description != null) {
          newSlot.description = timeSlot.description;
        }
        await newSlot.save();
      }
    }

    // Return success response if all slots were added successfully
    const response = ApiResponse("1", "Slots added successfully!", {});
    return res.json(response);
  } catch (error) {
    // Catch any errors and return an error response
    console.error("Error adding slots:", error);
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function update_slots(req, res) {

  try {
    const { times } = req.body;

    if (!times || !Array.isArray(times) || times.length === 0) {
      return res.json(ApiResponse("0", "No times data provided.", {}));
    }

    for (const dd of times) {
      let timeEntry = await Time.findOne({ where: { day: dd.day } });

      if (!timeEntry) {
        // Create new Time instance
        timeEntry = new Time();
        timeEntry.day = dd.day;
        timeEntry.status = dd.status || 1;
        await timeEntry.save();
      } else {
        // Update existing Time
        timeEntry.status = dd.status || 1;
        await timeEntry.save();
      }

      // Handle slots
      if (Array.isArray(dd.slots) && dd.slots.length > 0) {
        for (const slot of dd.slots) {
          // Normalize once per slot — input can be ms timestamp / UTC HH:mm
          // / AM/PM. Output is always canonical "hh:mm A" PKT.
          const normalizedStart = normalizeSlotTime(slot.start);
          const normalizedEnd = normalizeSlotTime(slot.end);

          if (slot.id) {
            const existingSlot = await Slot.findOne({
              where: { id: slot.id, TimeId: timeEntry.id }
            });

            if (existingSlot) {
              const newStart = normalizedStart ?? slot.start;
              const newEnd = normalizedEnd ?? slot.end;
              const timeChanged =
                String(existingSlot.start) !== String(newStart) ||
                String(existingSlot.end) !== String(newEnd);
              existingSlot.start = newStart;
              existingSlot.end = newEnd;
              existingSlot.trainerId = slot.trainerId;
              // Oct 2026 FIX: this used to set EVERY slot of the day back
              // to "Upcoming Class" whenever the admin saved the schedule.
              // A class that had ended (Completed) or was live (In
              // Progress) came back as "Get ready" in the app, then the
              // late-class job auto-cancelled it and told the women
              // "class cancelled". Now today's status is kept; only a
              // cancelled class that is moved to a new time is reopened.
              // (The nightly reset still makes every class "Upcoming".)
              if (timeChanged && existingSlot.status === "Cancelled") {
                existingSlot.status = "Upcoming Class";
              }
              // Workout details (type/level/description) used to only be
              // settable later, one slot at a time, via update_slot_trainer
              // -- meaning the trainer had to fill them in themselves after
              // the admin assigned them. Letting the admin send these here
              // too means the slot can be fully set up in one step. Each
              // field is only touched when the admin actually sent a real
              // value -- checked with != so both a missing key AND an
              // explicit null (what the Flutter form sends for a field
              // left blank) are skipped, not just a missing key. Otherwise
              // an admin who leaves these blank while just updating the
              // trainer would silently wipe out a value a trainer already
              // set the old way.
              if (slot.type != null) existingSlot.type = slot.type;
              if (slot.level != null) existingSlot.level = slot.level;
              if (slot.description != null) {
                existingSlot.description = slot.description;
              }
              await existingSlot.save();
              continue;
            }
          }

          const newSlot = new Slot();
          newSlot.start = normalizedStart ?? slot.start;
          newSlot.end = normalizedEnd ?? slot.end;
          newSlot.trainerId = slot.trainerId;
          newSlot.TimeId = timeEntry.id;
          newSlot.status = "Upcoming Class";
          if (slot.type != null) newSlot.type = slot.type;
          if (slot.level != null) newSlot.level = slot.level;
          if (slot.description != null) newSlot.description = slot.description;
          await newSlot.save();
        }
      }
    }

    return res.json(ApiResponse("1", "Slots updated successfully!", {}));
  } catch (error) {
    // No transaction was opened in this function — calling `t.rollback()`
    // here previously crashed the catch handler with "Cannot read
    // properties of undefined". If we ever introduce a transaction, the
    // rollback goes inside that transaction's scope, not here.
    console.error("Error updating slots:", error);
    return res.json(ApiResponse("0", error.message, {}));
  }
}

async function update_slot_trainer(req, res) {
  try {
    const { type, level, description, slotId } = req.body;

    // Find the slot by ID and wait for the result
    const slot = await Slot.findOne({ where: { id: slotId } });

    // Only the class's own trainer, or an admin, may change its details.
    if (slot) {
      const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
      if (!me || (Number(slot.trainerId) !== Number(me.id) && !require("../../../helper/roles").isAdmin(me))) {
        return res.json(ApiResponse("0", "You can only change your own classes.", {}));
      }
    }

    if (slot) {
      // Update the trainerId for the slot
      slot.type = type;
      slot.level = level;
      slot.description = description;
      await slot.save();

      const response = ApiResponse("1", "Slot updated successfully!", {});
      return res.json(response);
    } else {
      const response = ApiResponse(
        "0",
        "No slot available with the given ID.",
        {}
      );
      return res.json(response);
    }
  } catch (error) {
    // Catch any errors and return an error response
    console.error("Error updating slot:", error);
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function update_slot_status(req, res) {
  try {
    const { status, slotId } = req.body;
    // Trainer's reason when she cancels (portal, Nov 2026). Optional on the
    // server so older app versions can still cancel.
    const cancelReason = String((req.body && req.body.reason) || "").trim().slice(0, 200) || null;

    if (!slotId || !status) {
      return res.json(ApiResponse("0", "Missing slotId or status", {}));
    }

    const slot = await Slot.findOne({ where: { id: slotId } });

    if (!slot) {
      return res.json(ApiResponse("0", "No slot available with the given ID.", {}));
    }

    // A class the server auto-cancelled (not started 10 min after its
    // time, see helper/autoCancelLateClasses.js) stays cancelled: clients
    // were already told and sent to the next class.
    if (
      slot.status === "Cancelled" &&
      slot.completed_by == null &&
      status === "In Progress"
    ) {
      return res.json(
        ApiResponse("0", "This class was auto-cancelled because it didn't start within 10 minutes. Clients have been notified.", {})
      );
    }

    // Only the class's trainer or an admin can change it (clients could
    // call this endpoint before — anyone logged in could start/cancel).
    const actor = req.user && req.user.id
      ? await User.findByPk(req.user.id, { attributes: ["id", "userType", "timeZone"] })
      : null;
    const isAdmin = require("../../../helper/roles").isAdmin(actor);
    if (!actor || (!isAdmin && Number(slot.trainerId) !== Number(actor.id))) {
      return res.json(ApiResponse("0", "Only this class's trainer can change it.", {}));
    }

    // Start opens 10 minutes before class time, never earlier (women would
    // miss the start, and "starts in 15 min" reminders would arrive after
    // it went live). Admin can still start any time.
    if (status === "In Progress" && slot.status !== "In Progress" && !isAdmin) {
      const { parseEndAsUtc } = require("../../../helper/timeFormats");
      const START_EARLY_MIN = 10;
      const startUtc = parseEndAsUtc(slot.start, moment.tz("Asia/Karachi"));
      if (startUtc && moment.utc().isBefore(startUtc.clone().subtract(START_EARLY_MIN, "minutes"))) {
        const opens = startUtc.clone().subtract(START_EARLY_MIN, "minutes");
        const tz = (actor && actor.timeZone) || "Asia/Karachi";
        const at = opens.clone().tz(tz).format("h:mm A");
        return res.json(
          ApiResponse("0", `Too early. You can start this class at ${at} (10 minutes before).`, {
            code: "TOO_EARLY",
            opensAt: opens.toISOString(),
            opensAtLabel: at,
          })
        );
      }
    }

    // Start needs a room: the trainer's Zoom room (set once by admin) or
    // today's "Other link".
    if (status === "In Progress" && !slot.effectiveLink()) {
      return res.json(
        ApiResponse("0", "No Zoom room is set for you yet. Ask admin to add it, or use \"Other link\" for today.", { noRoom: true })
      );
    }
    const prevStatus = slot.status;

    // Emergency cancel (Nov 2026): only TODAY's class, and not one that has
    // already ended. A class's status is "today's" status and resets at
    // 00:01, so cancelling another day's class told women "cancelled today"
    // and the class still ran on its own day.
    if (status === "Cancelled" && prevStatus !== "Cancelled") {
      if (prevStatus === "Completed") {
        return res.json(ApiResponse("0", "This class has already ended, so it can't be cancelled.", { code: "ALREADY_ENDED" }));
      }
      const timeRow = slot.TimeId ? await Time.findByPk(slot.TimeId, { attributes: ["day"] }) : null;
      const classDay = timeRow && timeRow.day ? String(timeRow.day).trim() : null;
      const todayName = moment.tz("Asia/Karachi").format("dddd");
      if (classDay && classDay.toLowerCase() !== todayName.toLowerCase()) {
        return res.json(
          ApiResponse("0", `This class is on ${classDay}. You can cancel it on ${classDay}.`, { code: "NOT_TODAY", day: classDay })
        );
      }
    }

    // Update slot status. Capture the actor (req.user.id from validateToken)
    // and the change time so the audit log can distinguish manual ends
    // from auto-end cron flips. Auto-end intentionally writes NULL into
    // completed_by — that's the "trainer forgot" signal.
    const now = new Date();
    slot.status = status;
    if (req.user && req.user.id) slot.completed_by = req.user.id;
    slot.status_changed_at = now;
    await slot.save();

    // Class diary (analytics add-on, never blocks): one row per class per day.
    try {
      const diary = require("../../../helper/classDiary");
      if (status === "In Progress" && prevStatus !== "In Progress") diary.started(slot, actor);
      else if (status === "Completed" && prevStatus !== "Completed") {
        const byTrainer = actor && Number(slot.trainerId) === Number(actor.id);
        diary.ended(slot, byTrainer ? "trainer" : "admin", actor ? actor.id : null);
      } else if (status === "Cancelled" && prevStatus !== "Cancelled") {
        diary.cancelled(slot, { auto: false, actorId: actor ? actor.id : null, reason: cancelReason });
      }
    } catch (_) {}

    // Log operational timing metrics (trainer punctuality & class duration)
    try {
      if (status === "In Progress") {
        console.log(
          `[class-analytics] TRAINER_STARTED_CLASS: slotId=${slot.id} trainerId=${slot.trainerId} scheduledStart="${slot.start}" actualStart="${now.toISOString()}" actor=${req.user ? req.user.id : "unknown"}`
        );
      } else if (status === "Completed") {
        console.log(
          `[class-analytics] TRAINER_ENDED_CLASS: slotId=${slot.id} trainerId=${slot.trainerId} scheduledEnd="${slot.end}" actualEnd="${now.toISOString()}" endedBy=${slot.completed_by ? `trainer_${slot.completed_by}` : "auto_end_cron"}`
        );
      }
    } catch (_) {}

    // Fetch trainer details
    const trainer = await User.findOne({
      attributes: ["id", "firstName", "lastName", "email"],
      where: { id: slot.trainerId },
    });

    // Live update for every open app. The class link is inside only while
    // the class is live (models/Slot.js), so the card flips to "Join now".
    const plainSlot = slot.get({ plain: true });
    const data = {
      upcomingSlot: JSON.stringify(plainSlot),
      trainer: JSON.stringify(trainer ?? { id: 0, firstName: "", lastName: "", email: "" }),
    };
    try {
      getIO().emit("slotUpdate", data);
    } catch (e) {
      console.error("[update_slot_status] socket emit failed:", e.message);
    }

    // Pushes (Oct 2026): only "it's live" and "cancelled". Confirm /
    // Completed / anything else send nothing.
    if (status === "In Progress" && prevStatus !== "In Progress") {
      try {
        const { getClassAudience } = require("../../../helper/classAudience");
        const audience = await getClassAudience(slot);
        const type = (slot.type || slot.description || "Your class").trim();
        const withTrainer = trainer && trainer.firstName ? ` with ${trainer.firstName}` : "";
        const { getJoinWindowMinutes } = require("../../../helper/trialState");
        const win = getJoinWindowMinutes();
        const paidTokens = audience.filter((u) => !u.isTrial).map((u) => u.deviceToken).filter(Boolean);
        const trialTokens = audience.filter((u) => u.isTrial).map((u) => u.deviceToken).filter(Boolean);
        // upcomingSlot + trainer: OLD app versions (no class watcher) use
        // this payload to flip their card to "Join now" when the socket was
        // disconnected. Hidden data, never shown in the notification text.
        const pushData = {
          type: "classStart",
          slotId: String(slot.id),
          upcomingSlot: data.upcomingSlot,
          trainer: data.trainer,
        };
        if (paidTokens.length) {
          await notificationQueue.add({
            title: "Your class is live 🔔",
            body: `${type}${withTrainer} has started. Join now 💪`,
            data: pushData,
            deviceTokens: Array.from(new Set(paidTokens)),
          });
        }
        if (trialTokens.length) {
          await notificationQueue.add({
            title: "Your class is live 🔔",
            body: `${type}${withTrainer} has started. You have ${win} minutes to join 💪`,
            data: pushData,
            deviceTokens: Array.from(new Set(trialTokens)),
          });
        }
      } catch (e) {
        console.error("[update_slot_status] live push failed:", e.message);
      }
    } else if (status === "Cancelled" && prevStatus !== "Cancelled") {
      // Same warm message, next class and popup as the auto-cancel.
      try {
        const { announceCancelled } = require("../../../helper/autoCancelLateClasses");
        await announceCancelled(slot, { late: false });
      } catch (e) {
        console.error("[update_slot_status] cancel notice failed:", e.message);
      }
      // Tell the admins when a trainer cancels (Nov 2026): push + email
      // (helper/opsAlert.js), once per class per day, with her reason.
      if (!isAdmin) {
        try {
          const { opsAlert } = require("../../../helper/opsAlert");
          const who = trainer ? `${trainer.firstName || ""} ${trainer.lastName || ""}`.trim() : "A trainer";
          const what = (slot.type || slot.description || "class").trim();
          const day = moment.tz("Asia/Karachi").format("YYYY-MM-DD");
          await opsAlert(
            `trainer-cancel:${slot.id}:${day}`,
            "Class cancelled by trainer",
            `${who || "A trainer"} cancelled today's ${slot.start || ""} ${what}. Reason: ${cancelReason || "not given"}.`,
            { everyMinutes: 1440 }
          );
        } catch (e) {
          console.error("[update_slot_status] admin alert failed:", e.message);
        }
      }
    }

    if (status === "In Progress") {
      const { classInfo } = require("../classLinkController");
      const withTrainerRow = await Slot.findByPk(slot.id, {
        include: [
          { model: User, attributes: ["id", "firstName", "lastName", "zoomRoom"] },
          { model: Time, attributes: ["day"] },
        ],
      });
      return res.json(ApiResponse("1", "Class started", classInfo(withTrainerRow)));
    }
    return res.json(ApiResponse("1", "Slot updated successfully!", {}));
  } catch (error) {
    console.error("❌ Error in update_slot_status:", error);
    return res.json(ApiResponse("0", "Internal Server Error", {}));
  }
}

// API for getting all times with associated slots
async function getAllTimesWithSlots(req, res) {
  try {
    // Find all Time entries with associated Slots
    const times = await Time.findAll({
      include: [
        {
          model: Slot,
          // type/level/description added so the Add Trainer Slots screen
          // can show an already-set workout detail instead of blanking it
          // out on every load.
          attributes: [
            "id",
            "start",
            "end",
            "trainerId",
            "TimeId",
            "type",
            "level",
            "description",
          ],
        },
      ],
      attributes: ["id", "day", "status"], // Specify time fields you want to retrieve
    });

    const response = ApiResponse(
      "1",
      "Times with slots fetched successfully!",
      { times: times }
    );
    return res.json(response);
  } catch (error) {
    console.error("Error fetching times with slots:", error);
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_all_trainers(req, res) {
  const users = await User.findAll({
    where: { userType: "Trainer" },
    attributes: { exclude: ["password", "deviceToken"] }, // sec pass 1
  });
  const response = ApiResponse("1", "All Users", users);
  return res.json(response);
}

// async function update_trainer_link(req, res) {
//   const { planId, link } = req.body;
//   const data = await UserPlan.findOne({ where: { id: planId } });

//   if (data) {
//     data.trainerLink = link;
//     data
//       .save()
//       .then((dat) => {
//         let response = ApiResponse("1", "Link Updated successfully", {});
//         return res.json(response);
//       })
//       .catch((error) => {
//         let response = ApiResponse("0", error.message, {});
//         return res.json(response);
//       });
//   } else {
//     let response = ApiResponse("0", "Not found", {});
//     return res.json(response);
//   }
// }
async function update_trainer_link(req, res) {
  try {
    const { planId, link } = req.body;
    const data = await UserPlan.findOne({ where: { id: planId } });

    if (!data) {
      // If no plan is found
      let response = ApiResponse("0", "User plan not found", {});
      return res.json(response);
    }

    // Find the associated user
    const user = await User.findOne({ where: { id: data.UserId } });

    if (!user) {
      // If user not found, return an error response
      let response = ApiResponse("0", "User not found", {});
      return res.json(response);
    }

    // Update trainer link
    data.trainerLink = link;
    await data.save();

    // Send notification if deviceToken exists
    if (user.deviceToken) {
      let notification = {
        title: "Class Link Added",
        body: "Join the session now",

      };
      let data = {
        type: "trainerLinkAdded",
        isTrainer: true, // Adding isTrainer flag in the notification payload
      };
      sendNotification([user.deviceToken], notification, data);
    }

    let response = ApiResponse("1", "Link updated successfully", {});
    return res.json(response);
  } catch (error) {
    // Catch any unexpected error
    let response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

// Lightweight read used by the Flutter heartbeat (every 30s) and by smart
// triggers (foreground/reconnect/boundary). Returns only the fields the
// resolver/presentation needs — keeps the call cheap so polling at 30s
// cadence is OK across many users.
async function slotStatus(req, res) {
  const { id } = req.params;
  try {
    const slot = await Slot.findOne({
      where: { id },
      attributes: [
        "id",
        "status",
        "trainerLink",
        "isTrainerJoined",
        "joinedUserUID",
      ],
    });
    if (!slot) {
      return res.json(ApiResponse("0", "Slot not found", {}));
    }
    return res.json(ApiResponse("1", "Slot status", { slot }));
  } catch (err) {
    console.error("AdminController.slotStatus:", err);
    return res
      .status(500)
      .json({ status: "0", message: "Internal server error" });
  }
}

async function trainerHome(req, res) {
  const { userId } = req.params;
  // Her own classes only (admins may look at any trainer).
  {
    const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
    if (!me || (String(me.id) !== String(userId) && !require("../../../helper/roles").isAdmin(me))) {
      return res.json(ApiResponse("0", "You can only see your own classes.", {}));
    }
  }

  try {
    // Trainer's own timezone — render times in their local wall clock.
    let trainerTz = SLOT_DEFAULT_TZ;
    try {
      const u = await User.findOne({
        where: { id: userId },
        attributes: ["id", "timeZone"],
      });
      if (u && u.timeZone) trainerTz = u.timeZone;
    } catch (_) { /* fall back to default */ }

    const slots = await Slot.findAll({
      where: { trainerId: userId },
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        { model: Time, attributes: ["id", "day"] },
      ],
    });

    return res.json(ApiResponse("1", "Details", {
      trainerSlots: groupSlotsByLocalWeekday(slots, trainerTz),
    }));
  } catch (error) {
    console.error("Error fetching trainer plans:", error);
    return res
      .status(500)
      .json({ status: "0", message: "Internal server error" });
  }
}

// // Old trainer app versions call this with the pasted link. It is now the
// trainer's "Other link" for TODAY only (see classLinkController), with no
// push and no status change — the class room comes from the trainer's
// profile.
async function updateLink(req, res) {
  const { setBackupLink } = require("../classLinkController");
  req.body = { slotId: req.body && req.body.slotId, link: req.body && req.body.link };
  return setBackupLink(req, res);
}

async function updateTrainerJoin(req, res) {
  try {
    const { isTrainerJoined, joinedUserUID, slotId } = req.body; // Removed userId as it's not needed for all users

    // Freeze gate — when a regular User is joining the class
    // (joinedUserUID is set, isTrainerJoined is not true), block if
    // their plan is paused. Trainer-side calls (isTrainerJoined=true)
    // pass through unchanged. See helper/freezeGate.js.
    if (isTrainerJoined !== true && joinedUserUID) {
      const frozenPlan = await findFrozenActivePlan(joinedUserUID);
      if (frozenPlan) {
        return res.json(
          ApiResponse(
            "0",
            "Your plan is paused. Resume it from your profile to join workouts.",
            { isFrozen: true, frozenAt: frozenPlan.frozenAt }
          )
        );
      }
    }

    // Find the slot by ID
    const slot = await Slot.findOne({ where: { id: slotId } });

    if (!slot) {
      // If slot not found, send error response
      return res.json(ApiResponse("0", "Slot not found", {}));
    }

    // Sec pass 1: only this class's trainer (or Admin) may flip it.
    {
      const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
      if (!me || (Number(slot.trainerId) !== Number(me.id) && !require("../../../helper/roles").isAdmin(me))) {
        return res.json(ApiResponse("0", "You can only update your own classes.", {}));
      }
    }

    // Update the trainer link for the slot
    slot.isTrainerJoined = isTrainerJoined;
    slot.joinedUserUID = joinedUserUID;
    await slot.save();
    if (isTrainerJoined === true) {
      const trainer = await User.findOne({
        attributes: ["id", "firstName", "lastName", "email"],
        where: { id: slot?.trainerId },
      });
      const data = {
        upcomingSlot: JSON.stringify(slot ?? {}),
        trainer: JSON.stringify(trainer ?? {}),
      };

      // This previously had no socket emit at all (open-app users got
      // nothing) and queued the push with no deviceTokens (closed-app
      // users got nothing either) — same missing-roster bug as
      // updateLink, fixed the same way. TYPE_BY_TITLE already maps
      // "Trainer has Joined" → classStart.
      const io = getIO();
      io.emit("slotUpdate", data);

      const deviceTokens = await getDeviceTokensForSlot(slot);
      await notificationQueue.add({
        title: "Trainer has Joined",
        body: "Please join trainer has joined the class",
        data,
        deviceTokens,
      });
    }


    const response = ApiResponse(
      "1",
      "Link updated and notifications sent successfully",
      {}
    );
    return res.json(response);
  } catch (error) {
    // Catch and return unexpected errors
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function workout_plans(req, res) {
  try {
    let workout = await Category.findOne({
      where: { title: "Workout and Diet" },
    });
    if (workout) {
      let plans = await Plan.findAll({
        include: {
          model: SubCategory,
          attributes: [],
          where: { CategoryId: workout.id },
        },
        attributes: [
          "id",
          "title",
          "price",
          "shortDescription",
          "longDescription",
          "duration",
          "status",
          "image",
          "CategoryId",
          "subCategoryId",
        ],
      });
      let response = ApiResponse("1", "Workout and diet plans", { plans });
      return res.json(response);
    }
  } catch (error) {
    let response = ApiResponse("0", "Error", { error: error.message });
    return res.status(500).json(response);
  }
}

async function user_workout_plans(req, res) {
  try {
    const { userId } = req.params;
    // Category lookups are the legacy path — kept as a fallback, not
    // required. planType is the authoritative signal going forward (see
    // migration 20260902000001-add-plan-type-to-plans); this OR keeps
    // working unchanged before the catalog is backfilled and switches
    // to the reliable field automatically as plans get labeled, with no
    // second deploy needed. "combined" plans count as workout plans too
    // (mirrors the historical "Both" category behavior below).
    let workout = await Category.findOne({ where: { title: "Workout" } });
    let both = await Category.findOne({ where: { title: "Both" } });
    const categoryIds = [workout, both].filter(Boolean).map((c) => c.id);

    const or = [{ planType: { [Op.in]: ["workout", "combined"] } }];
    if (categoryIds.length > 0) or.push({ CategoryId: { [Op.in]: categoryIds } });

    let plans = await Plan.findAll({
      include: [
        {
          model: UserPlan,
          attributes: [],
          where: { UserId: userId },
          required: true,
        },
      ],
      attributes: [
        "id",
        "title",
        "shortDescription",
        "longDescription",
        "status",
        "image",
        "CategoryId",
        "subCategoryId",
        "planType",
      ],
      where: { [Op.or]: or },
    });

    let response = ApiResponse("1", "Workout and diet plans", { plans });
    return res.json(response);
  } catch (error) {
    let response = ApiResponse("0", "Error", { error: error.message });
    return res.status(500).json(response);
  }
}

async function assign_workout_diet_plan(req, res) {
  const { planId, dietitianId, trainerId } = req.body;
  let assigned = new AssignedPlan();
  assigned.PlanId = planId;
  assigned.dietitianId = dietitianId;
  assigned.trainerId = trainerId;
  assigned.UserId = dietitianId;
  await assigned.save();

  let response = ApiResponse("1", "Assigned Successfully", {});
  return res.json(response);
}

async function workout_plan_details(req, res) {
  const { id, userId, showSlots } = req.params;

  try {

     let slots = [];

    // Look up the user's timezone so slot times can be returned in their
    // local wall-clock. Falls back to the app's default tz if unset.
    let userTz = SLOT_DEFAULT_TZ;
    if (userId) {
      try {
        const u = await User.findOne({
          where: { id: userId },
          attributes: ["id", "timeZone"],
        });
        if (u && u.timeZone) userTz = u.timeZone;
      } catch (_) { /* ignore — fall back to default */ }
    }

    // ✅ If id is 0, return regular slots directly (skip plan check)
    if (id === "0") {
      slots = await Slot.findAll({
        where: {
          start: { [Op.ne]: "Start Time" },
          end: { [Op.ne]: "End Time" },
          trainerId: { [Op.ne]: null }
        },
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName", "email"]
          },
          {
            model: Time,
            attributes: ["id", "day"]
          }
        ]
      });

      return res.json(ApiResponse("1", "Regular slots", {
        trainerSlots: groupSlotsByLocalWeekday(slots, userTz),
        plan: null
      }));
    }

    const plan = await Plan.findOne({
      where: { id },
      attributes: ["id", "title", "shortDescription", "longDescription"]
    });

    if (!plan) {
      return res.status(200).json(ApiResponse("0", "Plan not found", {}));
    }


    // Find if this plan is a free trial plan
    if (plan.title === "Free Trial" && showSlots === "false") {
      const freeTrialData = await FreeTrailUsers.findOne({
        where: { freeTrialUser: userId },
        include: [
          {
            model: FreeTrailUsersSlots,
            as: "freeUserSlots",
            include: [
              {
                model: Slot,
                as: "slot",
                where: {
                  start: { [Op.ne]: "Start Time" },
                  end: { [Op.ne]: "End Time" },
                  trainerId: { [Op.ne]: null }
                },
                include: [
                  {
                    model: User,
                    attributes: ["id", "firstName", "lastName", "email"]
                  },
                  {
                    model: Time,
                    attributes: ["id", "day"]
                  }
                ]
              }
            ]
          }
        ]
      });

      if (
        freeTrialData &&
        freeTrialData.freeUserSlots &&
        Array.isArray(freeTrialData.freeUserSlots)
      ) {
        for (const slotItem of freeTrialData.freeUserSlots) {
          if (slotItem.slot) {
            slots.push(slotItem.slot);
          }
        }
      }
    } else {
      // Regular plan slots
      slots = await Slot.findAll({
        where: {
          start: { [Op.ne]: "Start Time" },
          end: { [Op.ne]: "End Time" },
          trainerId: { [Op.ne]: null }
        },
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName", "email"]
          },
          {
            model: Time,
            attributes: ["id", "day"]
          }
        ]
      });
    }

    return res.json(ApiResponse("1", "Details", {
      trainerSlots: groupSlotsByLocalWeekday(slots, userTz),
      plan: plan
    }));
  } catch (err) {
    console.error("❌ Error in workout_plan_details:", err);
    return res.status(200).json(ApiResponse("0", "Internal server error", {}));
  }
}

// Trainer roster for the CURRENT free-trial system (TrialJourney).
// getFreeTrialUserById above only reads FreeTrailUsersSlots, which nothing
// writes to anymore — every trial that goes through trialController.js
// (day1/2/3 booking) stores its slot picks directly on the TrialJourney row
// instead (day1SlotId/day2SlotId/day3SlotId). That left trainers with no way
// to see who's actually coming to their trial classes. This mirrors
// getFreeTrialUserById's (trainerId, slotId) shape so it's a drop-in
// replacement/addition on the trainer-facing screen.
async function getTrialJourneyUsersBySlot(req, res) {
  try {
    const { id: trainerId, slotId } = req.params;
    const slotIdNum = Number(slotId);

    if (!trainerId || !Number.isFinite(slotIdNum)) {
      return res.json(ApiResponse("0", "trainerId and slotId are required", {}));
    }

    // Confirm the slot actually belongs to this trainer before returning
    // anything — same guard getFreeTrialUserById relies on via its include.
    const slot = await Slot.findOne({ where: { id: slotIdNum, trainerId } });
    if (!slot) {
      return res.json(ApiResponse("1", "No trial users found", { users: [] }));
    }

    const journeys = await TrialJourney.findAll({
      where: {
        [Op.or]: [
          { day1SlotId: slotIdNum },
          { day2SlotId: slotIdNum },
          { day3SlotId: slotIdNum },
        ],
      },
      include: [{
        model: User,
        as: "user",
        attributes: ["id", "firstName", "lastName", "email", "bmiResult"],
      }],
    });

    const users = journeys
      .filter((j) => j.user)
      .map((j) => {
        const day = j.day1SlotId === slotIdNum ? 1
          : j.day2SlotId === slotIdNum ? 2
          : 3;
        return {
          user: j.user,
          day,
          bookedAt: j[`day${day}BookedAt`],
          attendedAt: j[`day${day}AttendedAt`],
        };
      });

    return res.json(ApiResponse("1", "Trial journey users fetched", { users }));
  } catch (error) {
    console.error("Error in getTrialJourneyUsersBySlot:", error);
    return res.json(ApiResponse("0", "Internal server error", {}));
  }
}

module.exports = {
  get_all_trainers,
  update_trainer_link,
  trainerHome,
  slotStatus,
  updateLink,
  workout_plans,
  assign_workout_diet_plan,
  workout_plan_details,
  user_workout_plans,
  add_slots,
  update_slots,
  update_slot_trainer,
  getAllTimesWithSlots,
  updateTrainerJoin,
  getTrialJourneyUsersBySlot,
  update_slot_status,
};
