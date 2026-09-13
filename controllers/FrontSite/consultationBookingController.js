const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { createEscalation } = require("../../helper/escalation");
const sendNotification = require("../../helper/notification");
const {
  Appointment,
  PendingPopupState,
  SlotDiet,
  TimeDietition,
  User,
} = require("../../models");

// Sequelize's DATE column comes back as a native JS Date instance for this
// dialect config — `String(date)` (used elsewhere in this file for the
// DATEONLY-shaped blockedSet keys) gives the human `Date#toString()` form,
// not an ISO date. Booking-context responses need the real YYYY-MM-DD, so
// this helper handles both a Date instance and an already-string value.
function toIsoDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

// Matches SLOT_WEEKDAY_NAMES in controllers/Admin/AdminController.js —
// index = JS Date#getUTCDay(), and TimeDietition.day is stored as one of
// these full English names ("Monday", "Tuesday", ...).
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// GET /users/dietitian-availability?dietitianId=&from=YYYY-MM-DD&to=YYYY-MM-DD
// Decision 3: reuse SlotDiet (parameterized to user). SlotDiet rows are
// weekday templates; we materialise concrete (date, slot) pairs in the
// requested range and mark each as booked or available based on existing
// Appointments. The `isAvailble` column was dropped 5/3 — availability is
// now derived from booked-against-Appointment.
exports.getDietitianAvailability = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const dietitianId = parseInt(req.query.dietitianId, 10);
    if (!Number.isInteger(dietitianId) || dietitianId <= 0) {
      return res.json(ApiResponse("0", "Invalid dietitianId", {}));
    }

    const from =
      typeof req.query.from === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
        ? req.query.from
        : new Date().toISOString().slice(0, 10);
    // Default window: 14 days forward.
    const toDefault = new Date(Date.now() + 14 * 86400000)
      .toISOString()
      .slice(0, 10);
    const to =
      typeof req.query.to === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
        ? req.query.to
        : toDefault;

    // Templates for this dietitian (one row per recurring weekday slot).
    // Each template belongs to ONE weekday (via TimeDietition.day) — we
    // need that to only surface a template on dates that actually fall
    // on its weekday.
    const templates = await SlotDiet.findAll({
      where: { dietitionId: dietitianId },
      attributes: ["id", "start", "end", "dietitionLink"],
      include: [{ model: TimeDietition, attributes: ["id", "day"] }],
    });

    // All appointments that block availability in the date range. Status
    // mirrors createAppointment's "Already booked" filter.
    const blockingAppts = await Appointment.findAll({
      where: {
        dietitionId: dietitianId,
        date: { [Op.between]: [from, to] },
        status: { [Op.in]: ["pending", "confirmed", "In Progress", "completed"] },
      },
      attributes: ["id", "date", "timeSlotId", "status", "userId"],
    });

    const blockedSet = new Set(
      blockingAppts.map((a) => `${a.timeSlotId}|${toIsoDate(a.date)}`)
    );

    // Walk every date in [from, to], emit one entry per template that
    // actually belongs to that date's weekday. Previously this emitted
    // EVERY template on EVERY date regardless of weekday — a dietitian
    // with, say, a "3:00 PM" slot configured on Monday, Wednesday, and
    // Friday would see "3:00 PM" three times on a single date instead
    // of once (and never on days it wasn't actually configured for).
    const out = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (
      let day = new Date(start);
      day.getTime() <= end.getTime();
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const isoDate = day.toISOString().slice(0, 10);
      const weekdayName = WEEKDAY_NAMES[day.getUTCDay()];
      for (const t of templates) {
        if (!t.TimeDietition || t.TimeDietition.day !== weekdayName) continue;
        const key = `${t.id}|${isoDate}`;
        out.push({
          slotDietId: t.id,
          date: isoDate,
          start: t.start,
          end: t.end,
          available: !blockedSet.has(key),
        });
      }
    }

    return res.json(
      ApiResponse("1", "Availability fetched", {
        dietitianId,
        from,
        to,
        slots: out,
      })
    );
  } catch (err) {
    console.error("[consultationBooking] availability:", err);
    return res.json(ApiResponse("0", "Failed to fetch availability", {}));
  }
};

// POST /appointment/:id/no-show
// User reports the dietitian didn't show up. Stamps noShowReportedAt and
// opens a CONSULT_NO_SHOW escalation. Both dietitian + admin notified
// (Section 12 trigger 3).
exports.reportNoShow = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const apptId = parseInt(req.params.id, 10);
    if (!Number.isInteger(apptId) || apptId <= 0) {
      return res.json(ApiResponse("0", "Invalid appointment id", {}));
    }

    const appt = await Appointment.findByPk(apptId);
    if (!appt) return res.json(ApiResponse("0", "Appointment not found", {}));
    if (appt.userId !== userId) {
      return res.json(ApiResponse("0", "Not your appointment", {}));
    }

    if (appt.noShowReportedAt) {
      return res.json(
        ApiResponse("0", "No-show already reported for this appointment", {})
      );
    }

    await appt.update({ noShowReportedAt: new Date() });

    try {
      await createEscalation({
        userId,
        dietitianId: appt.dietitionId,
        trigger: "CONSULT_NO_SHOW",
        severity: "high",
        payload: {
          appointmentId: appt.id,
          scheduledDate: appt.date,
          reason: (req.body && req.body.reason) || null,
        },
      });
    } catch (e) {
      console.error("[consultationBooking] escalation create failed:", e);
    }

    // Retire the consultant-no-show popup for this user.
    try {
      const variable = "POPUP_CONSULTANT_NO_SHOW";
      const existing = await PendingPopupState.findOne({
        where: { userId, popupVariable: variable, completedAt: null },
        order: [["createdAt", "DESC"]],
      });
      if (existing) {
        await existing.update({ completedAt: new Date() });
      }
    } catch (e) {
      console.error("[consultationBooking] popup retire failed:", e);
    }

    return res.json(
      ApiResponse("1", "No-show reported", { appointment: appt.toJSON() })
    );
  } catch (err) {
    console.error("[consultationBooking] reportNoShow:", err);
    return res.json(ApiResponse("0", "Failed to report no-show", {}));
  }
};

// GET /appointment/me/current
// Auth: validateToken
//
// User-facing counterpart to the dietitian-only GET
// /appointment/dietAppointments/:id. Returns the caller's single most
// relevant ACTIVE (pending/confirmed/In Progress) consultation booking,
// if any, so the Diet tab can render a "your booked consultation" card
// with Reschedule/Cancel actions. Ordered by date ascending — soonest
// upcoming booking wins. In normal use a user only ever holds one active
// booking at a time (createAppointment blocks double-booking the same
// slot+date, and the empty-state CTA only appears when there's none),
// but this doesn't assume that — it just picks the most relevant one.
//
// Never a hard error for "nothing booked" — { appointment: null } is a
// normal, expected response shape.
exports.getMyCurrentAppointment = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const appt = await Appointment.findOne({
      where: {
        userId,
        status: { [Op.in]: ["pending", "confirmed", "In Progress"] },
      },
      include: [
        { model: SlotDiet, attributes: ["id", "start", "end"] },
        // Unaliased on purpose — Appointment.belongsTo(User, {foreignKey:
        // 'dietitionId'}) is the only un-aliased User association on this
        // model (the client side is aliased "ClientUser"), so `{model:
        // User}` resolves to the dietitian.
        { model: User, attributes: ["id", "firstName", "lastName"] },
      ],
      order: [["date", "ASC"]],
    });

    if (!appt) {
      return res.json(
        ApiResponse("1", "No active appointment", { appointment: null })
      );
    }

    const dietitian = appt.User || null;
    const dietitianName = dietitian
      ? `${dietitian.firstName || ""} ${dietitian.lastName || ""}`.trim()
      : null;

    return res.json(
      ApiResponse("1", "Appointment fetched", {
        appointment: {
          id: appt.id,
          date: toIsoDate(appt.date),
          status: appt.status,
          kind: appt.kind,
          userId: appt.userId,
          userPlanId: appt.planId,
          dietitianId: appt.dietitionId,
          dietitianName: dietitianName || null,
          slotStart: appt.SlotDiet ? appt.SlotDiet.start : null,
          slotEnd: appt.SlotDiet ? appt.SlotDiet.end : null,
        },
      })
    );
  } catch (err) {
    console.error("[consultationBooking] getMyCurrentAppointment:", err);
    return res.json(ApiResponse("0", "Failed to fetch appointment", {}));
  }
};

// POST /appointment/:id/cancel
// Auth: validateToken
//
// User-initiated cancel. Distinct from the dietitian-facing PUT
// /appointment/:id (appointmentController.updateAppointment), which
// writes whatever status the caller sends with no ownership check at
// all — this endpoint is the properly-guarded counterpart for the
// client side: verifies req.user.id owns the appointment, and only
// allows the transition from a state the user can actually still back
// out of. Once a session is "In Progress" the dietitian owns the state
// transition; completed/already-canceled rows are a no-op error rather
// than silently rewriting history.
exports.cancelMyAppointment = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const apptId = parseInt(req.params.id, 10);
    if (!Number.isInteger(apptId) || apptId <= 0) {
      return res.json(ApiResponse("0", "Invalid appointment id", {}));
    }

    const appt = await Appointment.findByPk(apptId);
    if (!appt) return res.json(ApiResponse("0", "Appointment not found", {}));
    if (appt.userId !== userId) {
      return res.json(ApiResponse("0", "Not your appointment", {}));
    }
    if (!["pending", "confirmed"].includes(appt.status)) {
      return res.json(
        ApiResponse(
          "0",
          `Cannot cancel an appointment in status "${appt.status}".`,
          {}
        )
      );
    }

    appt.status = "canceledByUser";
    appt.completed_by = userId;
    appt.status_changed_at = new Date();
    await appt.save();

    try {
      const [dietitian, user] = await Promise.all([
        User.findByPk(appt.dietitionId),
        User.findByPk(userId),
      ]);
      if (dietitian && dietitian.deviceToken) {
        const clientName = user
          ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
          : "A client";
        await sendNotification(
          [dietitian.deviceToken],
          {
            title: "Appointment Canceled",
            body: `${clientName} canceled their appointment on ${toIsoDate(appt.date)}.`,
          },
          { type: "appointmentCanceledByUser" }
        );
      }
    } catch (e) {
      console.error("[consultationBooking] cancel notify failed:", e);
    }

    return res.json(
      ApiResponse("1", "Appointment canceled", { appointment: appt.toJSON() })
    );
  } catch (err) {
    console.error("[consultationBooking] cancelMyAppointment:", err);
    return res.json(ApiResponse("0", "Failed to cancel appointment", {}));
  }
};
