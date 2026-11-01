
const { Appointment, User, SlotDiet, AppointmentReview, ProgressSubmission, sequelize } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const sendNotification = require("../../helper/notification");
const { findFrozenActivePlan } = require("../../helper/freezeGate");
const bookingPolicy = require("../../helper/bookingPolicy");
const { queueConsultationCancelled } = require("../../helper/consultationCancelledPopup");
const { findClassClash } = require("../../helper/classClash");
const { Op } = require("sequelize");
const { isAdmin } = require("../../helper/roles");
const { getAssignedClientIds } = require("../../helper/dietitianScope");

// Never send these User columns to an app screen.
const USER_PRIVATE = ["password", "deviceToken"];


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
    // Nov 2026 audit: any staff account (a trainer too) could read any
    // dietitian's bookings with client emails. Own list, or Admin.
    const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
    if (!me || (Number(me.id) !== Number(id) && !isAdmin(me))) {
      return res.json(ApiResponse("0", "You can only see your own appointments.", {}));
    }
    const includeAll = req.query.includeAll === "true";
    // Nov 2026: ?recentDays=N also returns every booking of the last N days
    // (completed / cancelled too). The portal's "Did she join?" cards and
    // join/leave times need finished calls, which this list never had.
    const recentDays = Math.min(parseInt(req.query.recentDays, 10) || 0, 14);
    const active = { status: { [Op.in]: ["pending", "confirmed", "In Progress"] } };
    const where = includeAll
      ? { dietitionId: id }
      : recentDays > 0
      ? {
          dietitionId: id,
          [Op.or]: [active, { date: { [Op.gte]: new Date(Date.now() - (recentDays + 1) * 86400000) } }],
        }
      : { dietitionId: id, ...active };
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

    // Which consultation is this for the client — her 1st, 2nd, 3rd...?
    // = completed consultations she had before this one, + 1. One query
    // for all clients in the list, then counted in memory.
    const clientIds = [...new Set(appointments.map((a) => a.userId))];
    const completedRows = clientIds.length
      ? await Appointment.findAll({
          where: { userId: { [Op.in]: clientIds }, status: "completed" },
          attributes: ["id", "userId", "date"],
          raw: true,
        })
      : [];
    const withNumbers = appointments.map((a) => {
      const json = a.toJSON();
      const thisTime = new Date(a.date).getTime();
      const before = completedRows.filter(
        (c) =>
          c.userId === a.userId &&
          c.id !== a.id &&
          new Date(c.date).getTime() < thisTime
      ).length;
      json.consultNumber = before + 1;
      // Nov 2026: join / leave times (helper/consultAttendance.js).
      try {
        json.attendance = require("../../helper/consultAttendance").summarize(a, a.SlotDiet);
      } catch (_) {
        json.attendance = null;
      }
      return json;
    });

    const response = ApiResponse("1", "Appointments fetched successfully", { appointments: withNumbers });
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching appointments: ${error.message}`, {});
    return res.status(500).json(response);
  }
};

exports.getAllAppointmentStatus = async (req, res) => {
  try {
    // Sec pass 1: was every appointment (with client emails) for any
    // logged-in user. Admin still sees all; anyone else only the ones
    // she is the client or the dietitian on.
    const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
    if (!me) return res.json(ApiResponse("0", "User not found!", {}));
    const where = isAdmin(me)
      ? {}
      : { [Op.or]: [{ userId: me.id }, { dietitionId: me.id }] };
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
        { model: User, as: "ClientUser", attributes: { exclude: USER_PRIVATE } },
        { model: SlotDiet },
      ],
    });
    if (!appointment) {
      const response = ApiResponse("0", "Appointment not found", {});
      return res.status(404).json(response);
    }
    // Sec pass 1: only the client herself, her dietitian, or Admin.
    const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
    let allowed =
      !!me &&
      (Number(appointment.userId) === Number(me.id) ||
        Number(appointment.dietitionId) === Number(me.id) ||
        isAdmin(me));
    if (!allowed && me && ["dietition", "dietitian"].includes(String(me.userType || "").trim().toLowerCase())) {
      const ids = await getAssignedClientIds(me.id);
      allowed = ids.has(Number(appointment.userId));
    }
    if (!allowed) {
      return res.json(ApiResponse("0", "You can only see your own appointments.", {}));
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
  const { date, userId, dietitionId, timeSlotId, userPlanId, kind, message } = req.body;
  // Optional note from the client for the dietitian (fits the 255 char column).
  const userNote = typeof message === "string" && message.trim() ? message.trim().slice(0, 250) : null;
  if (!date || !userId || !dietitionId || !timeSlotId || !userPlanId) {
    const response = ApiResponse("0", "Invalid input data", {});
    return res.status(200).json(response);
  }

  // Nov 2026 audit: check the slot before anything else. The server used to
  // trust the app here, so a slot from another dietitian, a date on the
  // wrong weekday, or a time that had ALREADY PASSED could be booked. A past
  // time was then cancelled a minute later as a "dietitian no-show" and gave
  // her 3 free days every time.
  {
    const dayOnly = String(date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayOnly)) {
      return res.json(ApiResponse("0", "Invalid date", {}));
    }
    const { TimeDietition } = require("../../models");
    const slot = await SlotDiet.findByPk(timeSlotId, {
      attributes: ["id", "start", "end", "dietitionId"],
      include: [{ model: TimeDietition, attributes: ["id", "day"] }],
    });
    if (!slot || Number(slot.dietitionId) !== Number(dietitionId)) {
      return res.json(ApiResponse("0", "This time isn't available. Please pick another time.", { code: "SLOT_INVALID" }));
    }
    const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const [y0, m0, d0] = dayOnly.split("-").map(Number);
    const weekday = WD[new Date(Date.UTC(y0, m0 - 1, d0)).getUTCDay()];
    if (slot.TimeDietition && slot.TimeDietition.day && slot.TimeDietition.day !== weekday) {
      return res.json(ApiResponse("0", "This time isn't available on that day. Please pick another time.", { code: "SLOT_INVALID" }));
    }
    if (bookingPolicy.tooSoonToBook(dayOnly, slot)) {
      return res.json(
        ApiResponse(
          "0",
          `This time is too soon or has passed. Please pick a time at least ${bookingPolicy.MIN_BOOK_LEAD_MINUTES} minutes from now.`,
          { code: "SLOT_PAST" }
        )
      );
    }
  }
  // Consultation-flow extension (Phase 1A): if the client supplies `kind`
  // ("initial" | "followup") we persist it. Legacy callers omit it and
  // the column stays NULL — backward compatible.
  const VALID_KINDS = new Set(["initial", "followup"]);
  const persistedKind =
    typeof kind === "string" && VALID_KINDS.has(kind) ? kind : null;

  // Oct 2026: no booking into a dietitian's emergency day.
  if (await require("../../helper/emergencyDay").isBlocked(dietitionId, date)) {
    return res.json(
      ApiResponse("0", "Your dietitian isn't available on this day. Please pick another day.", { code: "DIETITIAN_DAY_OFF" })
    );
  }

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

  // Plan ended (Oct 2026): a new consultation needs a live plan. The plan
  // she books under must be hers and live (not expired, cancelled or
  // paused). Consultations booked before the plan ended are kept.
  try {
    const { UserPlan } = require("../../models");
    const { activeUserPlanWhere } = require("../../helper/activePackage");
    const live = await UserPlan.findOne({
      where: { id: userPlanId, userId, ...activeUserPlanWhere() },
      attributes: ["id"],
    });
    if (!live) {
      return res.json(
        ApiResponse("0", "Your plan has ended. Renew your plan to book a consultation.", { code: "PLAN_ENDED" })
      );
    }
  } catch (e) {
    console.error("[createAppointment] plan check failed:", e.message);
  }

  // Health form first (Oct 2026): the first consultation can't be booked
  // until her health form is done — the dietitian needs her answers.
  // Same rule as the form popup (helper/preConsultRequirements.js).
  // Follow-ups are not blocked.
  if (persistedKind !== "followup") {
    try {
      const { requirementsFor, planTypeForUser } = require("../../helper/preConsultRequirements");
      // Same questions as her form popup: her package decides (one truth).
      const formPlanType = (await planTypeForUser(userId)) || "diet";
      const req2 = await requirementsFor(userId, formPlanType);
      if (req2.shouldShow) {
        // Apps that never reported a version are OLD versions, which may
        // not open the form from here: tell her to update first, so she
        // isn't stuck with a message and no way forward.
        const who = await User.findByPk(userId, { attributes: ["appVersion"] });
        const oldApp = !who || !who.appVersion;
        return res.json(
          ApiResponse(
            "0",
            oldApp
              ? "Please update Fit Her to the latest version, then fill your short health form to book your consultation."
              : "Please fill your health form first. It helps your dietitian prepare for your consultation.",
            { code: "FORM_REQUIRED", planType: formPlanType }
          )
        );
      }
    } catch (e) {
      console.error("[createAppointment] form check failed:", e.message);
    }
  }

  // Change policy: after a second missed session her self-booking is
  // locked until staff reset it (helper/bookingPolicy.js).
  if (userPlanId) {
    const lockPlan = await bookingPolicy.planForAppointment({ planId: userPlanId });
    if (bookingPolicy.bookingLocked(lockPlan)) {
      return res.json(
        ApiResponse("0", bookingPolicy.MSG.locked, { code: "BOOKING_LOCKED" })
      );
    }
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
  // Bookings auto-confirm now, so her own UPCOMING confirmed booking is
  // not a "used" consultation: rebooking it is a reschedule (updated in
  // place below). Only a past/started/completed one counts. Without this,
  // rescheduling was refused and she had to cancel first.
  const usedConsultation = {
    [Op.or]: [
      { status: { [Op.in]: ["completed", "In Progress"] } },
      { status: "confirmed", date: { [Op.lte]: new Date() } },
    ],
  };
  const priorInitial = await Appointment.findOne({
    where: {
      userId,
      planId: userPlanId,
      kind: "initial",
      ...usedConsultation,
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
        ...usedConsultation,
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

  // Auto-confirm: the dietitian already said she's free by opening this
  // slot, so a booking no longer waits for her to tap "confirm". The
  // slot's Meet link is snapshotted onto the appointment right away —
  // the same snapshot updateAppointment used to take at confirm time.
  const bookedSlot = await SlotDiet.findByPk(timeSlotId, { transaction: t });
  const slotMeetLink =
    bookedSlot && bookedSlot.dietitionLink ? bookedSlot.dietitionLink : null;

  let appointment;
  let wasUpdated = false;
  let dietitianChanged = false;
  let previousDietitionId = null;

  // Change policy: moving an existing booking is only allowed until 24h
  // before it starts. Inside that window she can only cancel.
  if (
    ownActiveAppointment &&
    (await bookingPolicy.isInsideLateWindow(ownActiveAppointment, t))
  ) {
    return { lateReschedule: true };
  }

  if (ownActiveAppointment) {
    wasUpdated = true;
    previousDietitionId = ownActiveAppointment.dietitionId;
    dietitianChanged = previousDietitionId !== dietitionId;

    ownActiveAppointment.date = date;
    ownActiveAppointment.timeSlotId = timeSlotId;
    ownActiveAppointment.planId = userPlanId;
    // New time: the "in 15 minutes" reminder should go out again.
    ownActiveAppointment.reminderSentAt = null;
    // Nov 2026: taps and late alerts belonged to the old time.
    ownActiveAppointment.clientJoinTapAt = null;
    ownActiveAppointment.dietitianStartedAt = null;
    ownActiveAppointment.dietitianLateAlertAt = null;
    ownActiveAppointment.dietitionId = dietitionId;
    if (persistedKind) ownActiveAppointment.kind = persistedKind;
    if (userNote) ownActiveAppointment.message = userNote;
    // Moving to a new open slot is confirmed straight away, same as a
    // fresh booking (it used to drop back to "pending" for the dietitian
    // to re-confirm). Fresh Meet-link snapshot for the new slot.
    ownActiveAppointment.status = "confirmed";
    ownActiveAppointment.meetLink = slotMeetLink;
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
        status: "confirmed", // auto-confirmed — see bookedSlot above
        status_changed_at: new Date(),
        meetLink: slotMeetLink,
        planId: userPlanId,
        reschedule: isReschedule,
        kind: persistedKind,
        message: userNote,
      },
      { transaction: t }
    );
  }

  return {
    appointment,
    wasUpdated,
    dietitianChanged,
    previousDietitionId,
    slotStart: bookedSlot ? bookedSlot.start : null,
    slotEnd: bookedSlot ? bookedSlot.end : null,
    hasMeetLink: !!slotMeetLink,
  };
});

if (txResult.conflict) {
  const response = ApiResponse("0", "Time slot already booked", {});
  return res.status(200).json(response);
}
if (txResult.lateReschedule) {
  return res.status(200).json(
    ApiResponse("0", bookingPolicy.MSG.noReschedule, { code: "LATE_RESCHEDULE" })
  );
}

const {
  appointment,
  wasUpdated,
  dietitianChanged,
  previousDietitionId,
  slotStart,
  slotEnd,
  hasMeetLink,
} = txResult;

// "Thu 9 Oct, 6:00 PM" — built from the date string + the slot's
// wall-clock start, never from a Date object (see the timezone note on
// dayStr above).
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const [yy, mm, dd] = dayStr.split("-").map(Number);
const dayLabel =
  yy && mm && dd
    ? `${WEEKDAYS[new Date(Date.UTC(yy, mm - 1, dd)).getUTCDay()]} ${dd} ${MONTHS[mm - 1]}`
    : dayStr;
const when = slotStart ? `${dayLabel}, ${slotStart}` : dayLabel;
const linkNote = hasMeetLink
  ? ""
  : " This slot has no Meet link yet, please add one before the session.";

const user = await User.findByPk(userId);
const dietitian = await User.findByPk(dietitionId);
// Nov 2026: HER push shows the time in her own time zone; the dietitian's
// stays in Pakistan time (`when` above).
let whenForClient = when;
try {
  const st = slotStart ? bookingPolicy.sessionStartSync({ date: dayStr }, { start: slotStart }) : null;
  if (st) whenForClient = bookingPolicy.formatForUser(st, user && user.timeZone, true);
} catch (_) {}
// Nov 2026: a missing last name used to show as "undefined" in pushes.
const fullName = (u, fallback) =>
  (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "") || fallback;
const dietName = fullName(dietitian, "your dietitian");
const clientName = fullName(user, "A client");

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
    notify(user?.deviceToken, "Booking Updated", `Your consultation with ${dietName} is now on ${whenForClient}. You're all set!`, "bookingUpdated"),
    notify(dietitian?.deviceToken, "Booking Updated", `${clientName} moved their consultation to ${when}.${linkNote}`, "bookingUpdated"),
  ];
  // Rare (see comment above), but if the booking actually jumped to a
  // DIFFERENT dietitian, the old one's queue will silently lose this
  // row on next refresh (it no longer matches her dietitionId) unless
  // she's told why.
  if (dietitianChanged) {
    const previousDietitian = await User.findByPk(previousDietitionId);
    notifications.push(
      notify(previousDietitian?.deviceToken, "Booking Moved", `${clientName} rebooked their consultation with a different dietitian.`, "bookingMovedAway")
    );
  }
  await Promise.all(notifications);
} else {
  await Promise.all([
    notify(user?.deviceToken, "Appointment Confirmed", `Your consultation with ${dietName} is confirmed for ${whenForClient}. See you there!`, "appointmentConfirmed"),
    notify(dietitian?.deviceToken, "New Consultation Booked", `${clientName} booked a consultation for ${when}.${linkNote}`, "bookingAdded"),
  ]);
}

// Small "a live class runs at the same time" note for the booked screen
// (null when nothing overlaps or she has no workout package).
const classClash = await findClassClash(userId, dayStr, slotStart, slotEnd);
// Nov 2026: class times in that note in her own time zone too.
try {
  if (classClash && user && user.timeZone) {
    for (const k of ["clashClass", "joinAfter", "nextClass"]) {
      const c = classClash[k];
      if (c && c.time) {
        const st = bookingPolicy.sessionStartSync({ date: dayStr }, { start: c.time });
        if (st) c.time = bookingPolicy.formatForUser(st, user.timeZone);
      }
    }
  }
} catch (_) {}

const response = ApiResponse(
  "1",
  wasUpdated ? "Appointment updated successfully" : "Appointment created successfully",
  { appointment, wasUpdated, classClash }
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
    const isAdmin = String(caller.userType || "").trim().toLowerCase() === "admin";
    if (!isOwningDietitian && !isAdmin) {
      return res.status(403).json(
        ApiResponse("0", "You can only update your own appointments.", {})
      );
    }

    const statusChanged = status != null && status !== appointment.status;
    const prevStatus = appointment.status;

    // Nov 2026 audit: this accepted ANY status from ANY state, so a booking
    // could be "completed" days before it happened (using up her
    // consultation), set live without the time checks of /start, or moved
    // back from completed/cancelled. Allowed now (dietitian):
    //   pending -> confirmed
    //   pending / confirmed / In Progress -> canceled
    //   In Progress -> completed, or confirmed -> completed once its start
    //   time has passed (she ran the call without tapping Start)
    // "In Progress" only through POST /appointment/:id/start. Admin may
    // still make any change (support fixes).
    if (statusChanged) {
      const VALID = ["pending", "confirmed", "In Progress", "completed", "canceled", "canceledByUser"];
      if (!VALID.includes(status)) {
        return res.json(ApiResponse("0", "Unknown status", {}));
      }
      if (!isAdmin) {
        let ok = false;
        if (status === "confirmed") ok = prevStatus === "pending";
        else if (status === "canceled") ok = ["pending", "confirmed", "In Progress"].includes(prevStatus);
        else if (status === "completed") {
          if (prevStatus === "In Progress") ok = true;
          else if (prevStatus === "confirmed") {
            const st = await bookingPolicy.sessionStart(appointment);
            ok = !!st && Date.now() >= st.getTime();
            if (!ok) {
              return res.json(
                ApiResponse("0", "This consultation hasn't started yet, so it can't be marked completed.", { code: "NOT_STARTED" })
              );
            }
          }
        }
        if (!ok) {
          const hint = status === "In Progress" ? ' Use "Start session" instead.' : "";
          return res.json(
            ApiResponse("0", `This consultation is "${prevStatus}", so it can't be changed to "${status}".${hint}`, { code: "BAD_TRANSITION" })
          );
        }
      }
    }

    // On hold (payment not confirmed): it can't be started.
    if (statusChanged && status === "In Progress" && appointment.paymentHoldAt) {
      return res.json(
        ApiResponse("0", "This consultation is on hold: the client's payment isn't confirmed yet.", { code: "PAYMENT_HOLD" })
      );
    }

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
      // Nov 2026: she ended the call now.
      if (status === "completed" && !appointment.dietitianEndedAt) {
        appointment.dietitianEndedAt = new Date();
        appointment.dietitianEndSource = "tap";
      }
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

    // Dietitian (or admin) cancelled a live booking: whatever the timing,
    // the client gets the same free days as a dietitian no-show, once per
    // booking. Never counts against her change pass.
    let bonusDays = 0;
    if (
      statusChanged &&
      status === "canceled" &&
      ["pending", "confirmed", "In Progress"].includes(prevStatus) &&
      !(appointment.noShowBonusDays > 0)
    ) {
      try {
        const plan = await bookingPolicy.planForAppointment(appointment);
        if (plan && plan.expireDate) {
          bonusDays = bookingPolicy.DIETITIAN_NO_SHOW_BONUS_DAYS;
          await plan.update({
            expireDate: new Date(new Date(plan.expireDate).getTime() + bonusDays * 86400000),
          });
          await appointment.update({ noShowBonusDays: bonusDays });
        }
      } catch (e) {
        bonusDays = 0;
        console.error("[updateAppointment] cancel compensation failed:", e.message);
      }
    }
    // Dietitian/admin cancelled a live booking: in-app pop-up (urgent).
    if (
      statusChanged &&
      status === "canceled" &&
      ["pending", "confirmed", "In Progress"].includes(prevStatus)
    ) {
      await queueConsultationCancelled(appointment, "dietitian_cancelled", { bonusDays });
    }

    const user = await User.findByPk(appointment.userId);

    // Send notification if status was changed
    if (status != null && user?.deviceToken) {
      if (status === "canceled") {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Your session was canceled",
            body:
              "Your dietitian had to cancel your session" +
              (bonusDays > 0 ? `, so we've added ${bonusDays} free days to your package. ` : ". ") +
              "Open the Diet tab to pick a new time. It's free."
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

    // Nov 2026: session over → ask her to rate it (once, if she was there).
    if (statusChanged && status === "completed") {
      require("../../helper/consultReviewAsk").askForReview(appointment.id).catch(() => {});
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
    const isAdmin = String(caller.userType || "").trim().toLowerCase() === "admin";
    if (!isOwningDietitian && !isAdmin) {
      console.log(
        `[startAppointment] REJECTED — not owner. callerId=${caller.id} appointment.dietitionId=${appointment.dietitionId} callerType=${caller.userType}`
      );
      return res.status(403).json(
        ApiResponse("0", "You can only start your own consultations.", {})
      );
    }

    if (appointment.paymentHoldAt) {
      return res.status(200).json(
        ApiResponse("0", "This consultation is on hold: the client's payment isn't confirmed yet.", { code: "PAYMENT_HOLD" })
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

    // Too early: starting turns the client's Join button green, so it
    // only opens 10 minutes before the scheduled time.
    const openAt = await bookingPolicy.earliestStart(appointment);
    // Too late: the session's time is over. Starting it now would flip
    // the client's button green for a call that's no longer happening
    // (and the auto-end job would close it as "completed" a minute later).
    const slotForEnd = appointment.timeSlotId
      ? await SlotDiet.findByPk(appointment.timeSlotId, { attributes: ["id", "end"] })
      : null;
    const endsAt = bookingPolicy.sessionEnd(appointment, slotForEnd);
    if (endsAt && Date.now() > endsAt.getTime()) {
      return res.status(200).json(
        ApiResponse(
          "0",
          `This session's time has passed (it ended at ` +
            `${bookingPolicy.formatPkTime(endsAt)}), so it can't be started now. ` +
            `If the client didn't join, use "Client didn't join".`,
          { code: "TOO_LATE" }
        )
      );
    }

    if (openAt && Date.now() < openAt.getTime()) {
      return res.status(200).json(
        ApiResponse(
          "0",
          `It's too early to start this session. You can start it from ` +
            `${bookingPolicy.formatPkTime(openAt)} ` +
            `(${bookingPolicy.START_EARLY_MINUTES} minutes before).`,
          { code: "TOO_EARLY", startableAt: openAt }
        )
      );
    }

    appointment.status = "In Progress";
    appointment.completed_by = actorUserId != null ? actorUserId : appointment.dietitionId;
    appointment.status_changed_at = new Date();
    // Tap attendance (Oct 2026): when she started. First start only.
    if (!appointment.dietitianStartedAt) appointment.dietitianStartedAt = new Date();
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

    // Nov 2026: a 1-2 star session → tell the admins right away.
    if (ratingInt <= 2 && !existing) {
      try {
        const [client, diet, admins] = await Promise.all([
          User.findByPk(appointment.userId, { attributes: ["firstName", "lastName"] }),
          User.findByPk(appointment.dietitionId, { attributes: ["firstName", "lastName"] }),
          User.findAll({
            where: { userType: { [Op.like]: "admin%" }, deviceToken: { [Op.ne]: null } },
            attributes: ["deviceToken"],
          }),
        ]);
        const nm = (u, f) => (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "") || f;
        const tokens = admins.map((a) => a.deviceToken).filter(Boolean);
        if (tokens.length) {
          await sendNotification(
            tokens,
            {
              title: `Low session rating: ${ratingInt} star${ratingInt === 1 ? "" : "s"}`,
              body:
                `${nm(client, "A client")} rated her session with ${nm(diet, "a dietitian")}` +
                (comment ? `: "${String(comment).slice(0, 120)}"` : ".") + " Please check in with her.",
            },
            { type: "escalation" }
          );
        }
      } catch (e) {
        console.error("[review] low-rating alert:", e.message);
      }
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
