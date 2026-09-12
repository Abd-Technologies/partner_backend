const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { createEscalation } = require("../../helper/escalation");
const {
  Appointment,
  PendingPopupState,
  SlotDiet,
  TimeDietition,
} = require("../../models");

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
      blockingAppts.map((a) => `${a.timeSlotId}|${String(a.date).slice(0, 10)}`)
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
