
const { Appointment, User, SlotDiet, AppointmentReview, ProgressSubmission, sequelize } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const sendNotification = require("../../helper/notification");
const { findFrozenActivePlan } = require("../../helper/freezeGate");
const { Op } = require("sequelize");


// Get all appointments for a specific dietitian
//
// Returns only ACTIVE (actionable) bookings — pending/confirmed/In
// Progress — ordered soonest-first. This is the dietitian's home-panel
// "requests" queue, not a full history: completed and canceled rows used
// to come back here too with no filter and no ordering at all, so every
// appointment a client had EVER made (including ones already resolved,
// and every duplicate created before createAppointment deduped active
// bookings — see that function) piled up here forever as separate tiles,
// which read as the same client's request "not updating" and endlessly
// multiplying. A resolved appointment isn't a request anymore; it
// belongs in that client's history (ClientDetailsScreen), not this queue.
// Pass ?includeAll=true to opt back into the unfiltered list if some
// other caller genuinely needs full history through this endpoint.
exports.getAllAppointments = async (req, res) => {
  try {
    const { id } = req.params;
    const includeAll = req.query.includeAll === "true";
    const where = includeAll
      ? { dietitionId: id }
      : {
          dietitionId: id,
          status: { [Op.in]: ["pending", "confirmed", "In Progress"] },
        };
    const appointments = await Appointment.findAll({
      where,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          as: "ClientUser",
        },
        {
          model: SlotDiet,
          attributes: { exclude: ["createdAt", "updatedAt"] },
        },
      ],
      order: [["date", "ASC"]],
    });
    const response = ApiResponse("1", "Appointments fetched successfully", { appointments });
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching appointments: ${error.message}`, {});
    return res.status(500).json(response);
  }
};

exports.getAllAppointmentStatus = async (req, res) => {
  try {
    const appointments = await Appointment.findAll({
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          as: "ClientUser",
        },
        {
          model: SlotDiet,
          attributes: { exclude: ["createdAt", "updatedAt"] },
        },
      ],
    });
    const response = ApiResponse("1", "Appointments fetched successfully", { appointments });
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching appointments: ${error.message}`, {});
    return res.status(500).json(response);
  }
};

// Get a specific appointment by ID
exports.getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findByPk(id, {
      include: [
        { model: User, as: "ClientUser" },
        { model: SlotDiet },
      ],
    });
    if (!appointment) {
      const response = ApiResponse("0", "Appointment not found", {});
      return res.status(404).json(response);
    }
    const response = ApiResponse("1", "Appointment fetched successfully", appointment);
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching appointment: ${error.message}`, {});
    return res.status(500).json(response);
  }
};

// Create a new appointment
exports.createAppointment = async (req, res) => {
  const { date, userId, dietitionId, timeSlotId, userPlanId, kind } = req.body;
  if (!date || !userId || !dietitionId || !timeSlotId || !userPlanId) {
    const response = ApiResponse("0", "Invalid input data", {});
    return res.status(200).json(response);
  }
  // Consultation-flow extension (Phase 1A): if the client supplies `kind`
  // ("initial" | "followup") we persist it. Legacy callers omit it and
  // the column stays NULL — backward compatible.
  const VALID_KINDS = new Set(["initial", "followup"]);
  const persistedKind =
    typeof kind === "string" && VALID_KINDS.has(kind) ? kind : null;

  // Freeze gate — block consultation booking while the user's plan is
  // paused. Resume from profile to book again. See helper/freezeGate.js.
  const frozenPlan = await findFrozenActivePlan(userId);
  if (frozenPlan) {
    return res.json(
      ApiResponse(
        "0",
        "Your plan is paused. Resume it from your profile to book a consultation.",
        { isFrozen: true, frozenAt: frozenPlan.frozenAt }
      )
    );
  }

  try {
// Checkpoint gate (Phase 1C) — enforces docs/fit_her_consultation_flow.md
// Section 14: "2 consultations per month" (one initial + one Day-15
// follow-up) and "no new consultation before next scheduled checkpoint."
// Only engages when the caller sends `kind` — a legacy/no-kind caller
// skips this entirely, same backward-compat rule `persistedKind` above
// already follows.
//
// The spec's actual trigger for unlocking the follow-up is "Day 15
// mandatory progress submitted" (POPUP_DAY15_PROGRESS) — and that
// feature already exists (progressSubmissionController.js /
// ProgressSubmission, keyed by userPlanId + cycle). Gate on that
// directly rather than guessing from a date.
//
// Both lookups below deliberately exclude 'pending' — a pending
// initial/follow-up isn't "used" yet, it's just booked-and-awaiting-
// confirmation, and the dedup logic further down already reschedules a
// user's own pending row in place rather than creating a second one.
// Counting 'pending' here would incorrectly block that same reschedule.
if (persistedKind) {
  const priorInitial = await Appointment.findOne({
    where: {
      userId,
      planId: userPlanId,
      kind: "initial",
      status: { [Op.in]: ["confirmed", "completed", "In Progress"] },
    },
  });

  if (persistedKind === "initial" && priorInitial) {
    return res.json(
      ApiResponse(
        "0",
        "You've already had your initial consultation for this plan.",
        {}
      )
    );
  }

  if (persistedKind === "followup") {
    if (!priorInitial) {
      return res.json(
        ApiResponse("0", "Book your initial consultation first.", {})
      );
    }

    const priorFollowup = await Appointment.findOne({
      where: {
        userId,
        planId: userPlanId,
        kind: "followup",
        status: { [Op.in]: ["confirmed", "completed", "In Progress"] },
      },
    });
    if (priorFollowup) {
      return res.json(
        ApiResponse(
          "0",
          "You've already used your follow-up consultation for this plan. A new one unlocks with your next plan renewal.",
          {}
        )
      );
    }

    const day15Progress = await ProgressSubmission.findOne({
      where: { userPlanId, cycle: 15 },
    });
    if (!day15Progress) {
      return res.json(
        ApiResponse(
          "0",
          "Submit your Day 15 progress check-in before booking your follow-up consultation.",
          {}
        )
      );
    }
  }
}

// "Already booked" means another live appointment exists for the SAME
// slot template AND the SAME calendar date. SlotDiet rows are weekday
// templates, so without the date filter every successful booking would
// permanently consume the slot for all future dates.
//
// The status list also matters: prior code wrote "complete" (a value
// that doesn't exist in the enum), which silently freed slots for
// re-booking the moment a session finished. The enum value is
// "completed".
//
// Scoped to OTHER users only (`userId: {[Op.ne]: userId}`) — without
// that, a user re-opening the booking sheet and re-picking the exact
// slot+date their own pending/confirmed appointment already holds would
// get rejected as "already booked" by their own row. The upsert logic
// just below is what actually handles "the caller already holds this
// slot" correctly.
//
// RACE CONDITION FIX: this check used to run as a plain, unlocked read,
// completely disconnected from the Appointment.create()/save() below it.
// Two requests for the SAME slot+date landing close enough together —
// two clients each tapping "confirm" around the same moment — could BOTH
// pass this check before either write had landed. Wrapping the check and
// the create/update in one transaction with a row lock (FOR UPDATE)
// closes THAT window. It did NOT fix the actual bug hit in testing,
// though — see the note below.
//
// REAL BUG FOUND: `date` here is a plain "YYYY-MM-DD" string from the
// client. `Appointment.create()` a few lines down binds it as a raw
// prepared-statement parameter, so MySQL stores it completely literally
// ("2026-09-12" -> `2026-09-12 00:00:00`, no timezone math at all).
// But Sequelize's query-builder DOES apply DataType-aware escaping to a
// plain `where: { date }` condition on a DATE column: it re-parses the
// string through `new Date(date)` (parsed as UTC midnight) and
// re-serializes THAT using the dialect's configured timezone, which
// shifted it by 5 hours in testing (confirmed against raw table data:
// two rows stored with the IDENTICAL `date` value, `2026-09-12
// 00:00:00`, but the second booking's own collision check went out as
// `date = '2026-09-11 19:00:00'` — never matching the first row at all).
// That's the actual reason two different clients could book the exact
// same dietitian/slot/date: this check was comparing against a value
// that never equaled what was actually stored, transaction or no
// transaction. Comparing `DATE(date)` against a plain calendar-day
// string sidesteps that Date-object round trip entirely — MySQL parses
// a bare "YYYY-MM-DD" literal on its own, no Node-side timezone
// conversion involved.
const dayStr = String(date).slice(0, 10);

const txResult = await sequelize.transaction(async (t) => {
  const existingAppointment = await Appointment.findOne({
    where: {
      timeSlotId,
      userId: { [Op.ne]: userId },
      status: {
        [Op.in]: ["pending", "confirmed", "In Progress", "completed"]
      },
      [Op.and]: [
        sequelize.where(sequelize.fn("DATE", sequelize.col("date")), dayStr),
      ],
    },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  if (existingAppointment) {
    return { conflict: true };
  }

  // Reschedule signal — "did THIS user's most recent appointment on
  // THIS plan get canceled (by either side), and is she now rebooking
  // within a reasonable window?". Deliberately NOT scoped to the same
  // timeSlotId/date: a real reschedule is almost always a DIFFERENT day
  // or time, so requiring an exact slot+date match meant this flag
  // practically never fired (see RescheduleRequestScreen on the
  // dietitian side, which reads it). Scoped to the same userPlanId so
  // an unrelated old cancellation (a previous plan/cycle) never taints
  // a fresh purchase's first booking.
  const RESCHEDULE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const priorCancellation = await Appointment.findOne({
    where: {
      userId,
      planId: userPlanId,
      status: { [Op.in]: ["canceled", "canceledByUser"] },
    },
    order: [["status_changed_at", "DESC"], ["updatedAt", "DESC"]],
    transaction: t,
  });
  const cancelTimestamp =
    priorCancellation &&
    (priorCancellation.status_changed_at || priorCancellation.updatedAt);
  const isReschedule =
    !!cancelTimestamp &&
    Date.now() - new Date(cancelTimestamp).getTime() <= RESCHEDULE_WINDOW_MS;

  // Dedup at the source: a user can only ever hold ONE active
  // (pending/confirmed) consultation at a time, full stop — not one
  // per dietitian. Scoping this lookup to `userId` alone (no
  // `dietitionId` filter) is what makes that true; scoping it to
  // userId+dietitionId (the first version of this fix) still let a
  // user end up with two simultaneous active bookings whenever the
  // resolved dietitian differed between two booking attempts — e.g. an
  // admin reassignment landing between them, or two entry points
  // resolving bookingContext at slightly different times. Whatever
  // dietitian a NEW booking names, it updates the user's one existing
  // active row (moving it to the new dietitian too, if different)
  // rather than ever creating a second one. "In Progress" is
  // deliberately excluded from the match: once a session has started,
  // a fresh booking attempt creates a genuinely new (future)
  // appointment rather than silently rewriting the one that's live
  // right now — nothing in the current UI can actually trigger that
  // combination, but it's the safer behavior if it ever happens.
  const ownActiveAppointment = await Appointment.findOne({
    where: {
      userId,
      status: { [Op.in]: ["pending", "confirmed"] },
    },
    order: [["createdAt", "DESC"]],
    transaction: t,
    lock: t.LOCK.UPDATE,
  });

  let appointment;
  let wasUpdated = false;
  let dietitianChanged = false;
  let previousDietitionId = null;

  if (ownActiveAppointment) {
    wasUpdated = true;
    previousDietitionId = ownActiveAppointment.dietitionId;
    dietitianChanged = previousDietitionId !== dietitionId;

    ownActiveAppointment.date = date;
    ownActiveAppointment.timeSlotId = timeSlotId;
    ownActiveAppointment.planId = userPlanId;
    ownActiveAppointment.dietitionId = dietitionId;
    if (persistedKind) ownActiveAppointment.kind = persistedKind;
    // The old time is no longer valid even if it was already
    // confirmed — moving it re-opens it for the dietitian to confirm
    // the NEW time, same as a fresh request would need.
    ownActiveAppointment.status = "pending";
    ownActiveAppointment.reschedule = true;
    ownActiveAppointment.status_changed_at = new Date();
    await ownActiveAppointment.save({ transaction: t });
    appointment = ownActiveAppointment;
  } else {
    appointment = await Appointment.create(
      {
        date,
        userId,
        dietitionId,
        timeSlotId,
        status: "pending",
        planId: userPlanId,
        reschedule: isReschedule,
        kind: persistedKind,
      },
      { transaction: t }
    );
  }

  return { appointment, wasUpdated, dietitianChanged, previousDietitionId };
});

if (txResult.conflict) {
  const response = ApiResponse("0", "Time slot already booked", {});
  return res.status(200).json(response);
}

const { appointment, wasUpdated, dietitianChanged, previousDietitionId } = txResult;

const user = await User.findByPk(userId);
const dietitian = await User.findByPk(dietitionId);

const notify = async (deviceToken, title, body, type) => {
  if (deviceToken) {
    try {
      await sendNotification([deviceToken], { title, body }, { type });
    } catch (err) {
      console.error("Notification error:", err.message);
    }
  }
};

if (wasUpdated) {
  const notifications = [
    notify(user?.deviceToken, "Booking Updated", `Your consultation with ${dietitian?.firstName} ${dietitian?.lastName} has been moved. Please wait for confirmation.`, "bookingUpdated"),
    notify(dietitian?.deviceToken, "Booking Updated", `${user?.firstName} ${user?.lastName} moved their appointment. Please review the new time.`, "bookingUpdated"),
  ];
  // Rare (see comment above), but if the booking actually jumped to a
  // DIFFERENT dietitian, the old one's queue will silently lose this
  // row on next refresh (it no longer matches her dietitionId) unless
  // she's told why.
  if (dietitianChanged) {
    const previousDietitian = await User.findByPk(previousDietitionId);
    notifications.push(
      notify(previousDietitian?.deviceToken, "Booking Moved", `${user?.firstName} ${user?.lastName} rebooked their consultation with a different dietitian.`, "bookingMovedAway")
    );
  }
  await Promise.all(notifications);
} else {
  await Promise.all([
    notify(user?.deviceToken, "Booking Pending", `Your booking has been sent to ${dietitian?.firstName} ${dietitian?.lastName}. Please wait for confirmation`, "bookingPending"),
    notify(dietitian?.deviceToken, "Booking Added", `Your booking has been added with ${user?.firstName} ${user?.lastName}`, "bookingAdded"),
  ]);
}

const response = ApiResponse(
  "1",
  wasUpdated ? "Appointment updated successfully" : "Appointment created successfully",
  { appointment, wasUpdated }
);
return res.status(200).json(response);
  } catch (error) {
    console.error("Create error:", error);
    const response = ApiResponse("0", "Error creating appointment", { error: error.message });
    return res.status(500).json(response);
  }
};

// Update an appointment
exports.updateAppointment = async (req, res) => {
  const { id } = req.params;
  const { status, reschedule, actorUserId } = req.body;

  console.log("Update status:", req.body);

  try {
    const appointment = await Appointment.findOne({ where: { id } });

    if (!appointment) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }

    // This endpoint used to trust the caller completely — no auth at
    // all, anyone who knew an appointment id could confirm/cancel it.
    // Now behind validateToken + validateAdmin (see routes file); this
    // is the ownership check, same pattern as /:id/start.
    const caller = req.user || {};
    const isOwningDietitian = caller.id === appointment.dietitionId;
    const isAdmin = caller.userType === "Admin";
    if (!isOwningDietitian && !isAdmin) {
      return res.status(403).json(
        ApiResponse("0", "You can only update your own appointments.", {})
      );
    }

    const statusChanged = status != null && status !== appointment.status;

    if (status != null) {
      appointment.status = status;
    }

    if (reschedule != null) {
      appointment.reschedule = reschedule;
    }

    // Audit signal — mirrors Slot.completed_by. Manual endpoint MUST set
    // completed_by; NULL is reserved for the auto-end cron. actorUserId
    // is whichever side flipped the status (dietitian for confirm/cancel/
    // complete, user for canceledByUser).
    if (statusChanged) {
      appointment.completed_by = actorUserId != null ? actorUserId : appointment.dietitionId;
      appointment.status_changed_at = new Date();
    }

    // Snapshot the slot's current Meet link onto this appointment the
    // moment it's confirmed. dietitionLink lives on SlotDiet (the
    // recurring weekly slot template), shared across every week's
    // booking into it — without this snapshot, the dietitian updating
    // the link later would live-affect every other still-upcoming
    // appointment on that same weekly slot, including a different
    // client's different week. Once frozen here, only a fresh
    // confirmation (a fresh snapshot) picks up a later link change.
    // Only fires on the transition INTO "confirmed", and only if we
    // haven't already got one (so re-saving an already-confirmed
    // appointment for an unrelated reason doesn't re-snapshot it).
    if (statusChanged && status === "confirmed" && !appointment.meetLink) {
      const slot = await SlotDiet.findByPk(appointment.timeSlotId);
      if (slot && slot.dietitionLink) {
        appointment.meetLink = slot.dietitionLink;
      }
    }

    await appointment.save();

    const user = await User.findByPk(appointment.userId);

    // Send notification if status was changed
    if (status != null && user?.deviceToken) {
      if (status === "canceled") {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Appointment Canceled",
            body: "Your appointment has been canceled by your dietitian. You can reschedule it at your convenience."
          },
          { type: "appointmentCanceled" }
        );
      } else if (status === "confirmed") {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Appointment Confirmed",
            body: "Your appointment has been confirmed by your dietitian. Please be on time. Thank you!"
          },
          { type: "appointmentConfirmed" }
        );
      }
    }

    return res.status(200).json(ApiResponse("1", "Appointment updated successfully", { appointment }));
  } catch (error) {
    console.error("Error updating appointment:", error);
    return res.status(500).json(ApiResponse("0", "Error updating appointment", { error: error.message }));
  }
};



// Delete an appointment
exports.deleteAppointment = async (req, res) => {
  const { id } = req.params;
  try {
    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }
    await appointment.destroy();
    const response = ApiResponse("1", `Appiontment Canceled Successfully`, {});

    res.status(200).json(response);
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json(ApiResponse("0", "Error canceling appointment", {}));
  }
};


// Flip a confirmed appointment to "In Progress". Mirrors the trainer
// "Start Session" pattern — without an explicit live-state, the auto-end
// cron can't distinguish a no-show from a session that ran late, so a
// no-show would be silently auto-completed.
exports.startAppointment = async (req, res) => {
  const { id } = req.params;
  const { actorUserId } = req.body;

  // TEMP DEBUG (remove once Start Session is confirmed working end to
  // end) — proves whether the click is even reaching the server at
  // all, and if so, exactly why it's being rejected.
  console.log(
    `[startAppointment] REQUEST RECEIVED — appointmentId=${id} callerId=${req.user && req.user.id} callerType=${req.user && req.user.userType}`
  );

  try {
    const appointment = await Appointment.findOne({ where: { id } });
    if (!appointment) {
      console.log(`[startAppointment] REJECTED — no appointment with id=${id}`);
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }

    // Ownership check — this route had no auth at all before (anyone
    // could flip anyone's appointment live). Now it's behind
    // validateToken + validateAdmin, so req.user.id is the logged-in
    // staff member; only the dietitian who owns this appointment (or an
    // Admin, for support/override cases) may start it.
    const caller = req.user || {};
    const isOwningDietitian = caller.id === appointment.dietitionId;
    const isAdmin = caller.userType === "Admin";
    if (!isOwningDietitian && !isAdmin) {
      console.log(
        `[startAppointment] REJECTED — not owner. callerId=${caller.id} appointment.dietitionId=${appointment.dietitionId} callerType=${caller.userType}`
      );
      return res.status(403).json(
        ApiResponse("0", "You can only start your own consultations.", {})
      );
    }

    if (appointment.status !== "confirmed") {
      console.log(
        `[startAppointment] REJECTED — status is "${appointment.status}", not "confirmed"`
      );
      return res.status(200).json(
        ApiResponse(
          "0",
          `Cannot start an appointment in status "${appointment.status}". Confirm it first.`,
          {}
        )
      );
    }

    appointment.status = "In Progress";
    appointment.completed_by = actorUserId != null ? actorUserId : appointment.dietitionId;
    appointment.status_changed_at = new Date();
    await appointment.save();
    console.log(`[startAppointment] SUCCESS — appointmentId=${id} now In Progress`);

    // Client-facing heads-up that the session is live. The Join Meeting
    // button on her screen also flips green on its own (it polls every
    // 20s), but a push means she doesn't have to have the app open and
    // staring at the card to notice.
    try {
      const client = await User.findByPk(appointment.userId);
      if (client && client.deviceToken) {
        await sendNotification(
          [client.deviceToken],
          {
            title: "Your session is starting",
            body: "Your dietitian has started the consultation — tap to join.",
          },
          { type: "appointmentStarted", appointmentId: appointment.id }
        );
      }
    } catch (notifyErr) {
      console.error("[appointmentController] start notify failed:", notifyErr);
    }

    return res.status(200).json(
      ApiResponse("1", "Appointment started", { appointment })
    );
  } catch (error) {
    console.error("Start error:", error);
    return res.status(500).json(
      ApiResponse("0", "Error starting appointment", { error: error.message })
    );
  }
};

// Per-consultation review. Only the user who attended the consultation
// can leave one, and only after status is `completed`. The unique index
// on appointmentId means a second submission updates the existing row
// rather than creating a duplicate.
exports.createAppointmentReview = async (req, res) => {
  const { id } = req.params;
  const { rating, comment } = req.body;

  if (!req.user || !req.user.id) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const ratingInt = Number(rating);
  if (!Number.isInteger(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return res.json(ApiResponse("0", "Rating must be an integer 1-5", {}));
  }

  try {
    const appointment = await Appointment.findOne({ where: { id } });
    if (!appointment) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }
    if (appointment.userId !== req.user.id) {
      return res.json(ApiResponse("0", "You can only review your own consultations", {}));
    }
    if (appointment.status !== "completed") {
      return res.json(
        ApiResponse(
          "0",
          `Cannot review an appointment in status "${appointment.status}". Only completed consultations can be reviewed.`,
          {}
        )
      );
    }

    // Upsert via the unique index on appointmentId — re-submission
    // updates the existing row, so users can correct a typo without
    // hitting a duplicate-key error.
    const existing = await AppointmentReview.findOne({ where: { appointmentId: id } });
    let review;
    if (existing) {
      existing.rating = ratingInt;
      existing.comment = comment ?? null;
      await existing.save();
      review = existing;
    } else {
      review = await AppointmentReview.create({
        appointmentId: appointment.id,
        userId: req.user.id,
        rating: ratingInt,
        comment: comment ?? null,
      });
    }

    return res.json(ApiResponse("1", "Review saved", { review }));
  } catch (error) {
    console.error("Review error:", error);
    return res.status(500).json(
      ApiResponse("0", "Error saving review", { error: error.message })
    );
  }
};

// Get all clients (appointments) where reshadule is true
//
// Same disease as getAllAppointments used to have, times two:
//   1) No dietitianId scoping at all — every dietitian's "Requests"
//      (reschedule:false) and "Reschedule Requests" (reschedule:true)
//      screens were pulling EVERY client's rows across the WHOLE app,
//      not just her own.
//   2) No status filter — a row stayed in this list forever even after
//      it was approved/canceled, since resolving it never changes
//      `reschedule`, only `status`. A client who got confirmed still
//      showed up here as an open "request" on every future load.
// Fixed the same way as getAllAppointments: scope to the calling
// dietitian and to actionable statuses only. ?includeAll=true opts back
// into the unfiltered-by-status list (still dietitian-scoped) for the
// rare caller that wants full history.
exports.getAllRescheduledAppointments = async (req, res) => {

  try {
  const { reschedule, dietitianId } = req.params;
  // Express route params are always strings ("true"/"false"), but
  // `reschedule` is a BOOLEAN column. Passing the raw string straight
  // into `where` used to compare `reschedule = 'true'` at the SQL
  // level — MySQL coerces a non-numeric string to 0 when comparing
  // against a numeric/tinyint column, so BOTH ".../true" and
  // ".../false" silently matched only reschedule=false rows. That
  // made the dietitian's "Reschedule Requests" screen
  // (RescheduleRequestScreen, called with reschedule:true) always come
  // back with ordinary non-reschedule bookings instead of the actual
  // flagged ones — functionally indistinguishable from the "Requests"
  // screen. Explicit boolean coercion fixes the comparison.
  const isReschedule = reschedule === 'true' || reschedule === '1';
  const includeAll = req.query.includeAll === "true";

    const where = includeAll
      ? { reschedule: isReschedule, dietitionId: dietitianId }
      : {
          reschedule: isReschedule,
          dietitionId: dietitianId,
          status: { [Op.in]: ["pending", "confirmed", "In Progress"] },
        };

    const appointments = await Appointment.findAll({
      where,
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          as: "ClientUser",
        },
        {
          model: SlotDiet,
          attributes: { exclude: ["createdAt", "updatedAt"] },
        },
      ],
      order: [["date", "ASC"]],
    });

    const response = ApiResponse("1", "Rescheduled appointments fetched successfully", { appointments });
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching rescheduled appointments: ${error.message}`, {});
    return res.status(500).json(response);
  }
};
