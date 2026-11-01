const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const db = require("../../models");
const { createEscalation } = require("../../helper/escalation");
const sendNotification = require("../../helper/notification");
const { resolveDietitianNoShow, resolveClientNoShow } = require("../../helper/noShowResolution");
const {
  NO_SHOW_GRACE_MINUTES,
  NO_SHOW_STALE_HOURS,
} = require("../../helper/popupEligibility");
const {
  Appointment,
  PendingPopupState,
  SlotDiet,
  TimeDietition,
  User,
} = require("../../models");
const bookingPolicy = require("../../helper/bookingPolicy");

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

// Same rule popupEligibility.js's evaluateConsultantNoShows uses to
// decide whether to fire POPUP_CONSULTANT_NO_SHOW — reused here so the
// Diet tab's UpcomingConsultationCard can show a "consultant hasn't
// joined" state inline on the appointment itself, in context, instead
// of only via the (now non-blocking, see popup_orchestrator.dart)
// interrupting sheet. False again past NO_SHOW_STALE_HOURS since by
// then evaluateConsultantNoShows has auto-retired it and opened an
// escalation for staff to follow up on instead.
function isAwaitingConsultant(appt) {
  if (!appt || appt.status !== "confirmed" || appt.noShowReportedAt || appt.paymentHoldAt) {
    return false;
  }
  // appt.date is only the DAY; the start time comes from the slot.
  const start = bookingPolicy.sessionStartSync(appt, appt.SlotDiet);
  if (!start) return false;
  const minutesLate = (Date.now() - start.getTime()) / 60000;
  return minutesLate >= NO_SHOW_GRACE_MINUTES && minutesLate < NO_SHOW_STALE_HOURS * 60;
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
    // Oct 2026: her emergency days are fully closed (helper/emergencyDay.js).
    const emergencyDays = await require("../../helper/emergencyDay").blockedDays(dietitianId, from, to);

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
        // Nov 2026: a time that has already passed today can't be booked.
        const past = bookingPolicy.tooSoonToBook(isoDate, t);
        out.push({
          slotDietId: t.id,
          date: isoDate,
          start: t.start,
          end: t.end,
          available: !past && !blockedSet.has(key) && !emergencyDays.has(isoDate),
        });
      }
    }

    // Send the assigned dietitian's name so every booking screen can show it.
    const dietUser = await User.findByPk(dietitianId, { attributes: ["firstName", "lastName"] });
    const dietitianName = dietUser ? `${dietUser.firstName || ""} ${dietUser.lastName || ""}`.trim() || null : null;

    return res.json(
      ApiResponse("1", "Availability fetched", {
        dietitianId,
        dietitianName,
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

// (Removed Oct 2026: POST /appointment/:id/no-show, the client's
// "my dietitian didn't join" report. The server decides no-shows now —
// see helper/noShowResolution.js and helper/checkMeetAttendance.js.)

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

    const includeOpts = [
      { model: SlotDiet, attributes: ["id", "start", "end", "dietitionLink"] },
      // Unaliased on purpose — Appointment.belongsTo(User, {foreignKey:
      // 'dietitionId'}) is the only un-aliased User association on this
      // model (the client side is aliased "ClientUser"), so `{model:
      // User}` resolves to the dietitian.
      { model: User, attributes: ["id", "firstName", "lastName"] },
    ];

    // Priority 1: an appointment that's still actually active.
    let appt = await Appointment.findOne({
      where: {
        userId,
        status: { [Op.in]: ["pending", "confirmed", "In Progress"] },
      },
      include: includeOpts,
      order: [["date", "ASC"]],
    });

    // Priority 2 (fallback): nothing active, but something wrapped up
    // recently — keep showing it for a short window afterward so the
    // client sees the "your plan will be delivered" state instead of
    // the card just vanishing the instant the auto-end cron marks it
    // completed. RECENT_COMPLETION_WINDOW_HOURS controls how long.
    if (!appt) {
      const RECENT_COMPLETION_WINDOW_HOURS = 48;
      const cutoff = new Date(Date.now() - RECENT_COMPLETION_WINDOW_HOURS * 60 * 60 * 1000);
      appt = await Appointment.findOne({
        where: {
          userId,
          status: "completed",
          status_changed_at: { [Op.gte]: cutoff },
        },
        include: includeOpts,
        order: [["status_changed_at", "DESC"]],
      });
    }

    // Priority 3 (fallback): the dietitian never showed up and it's
    // been resolved (see helper/noShowResolution.js — either the
    // client reported it, or 24h passed with nobody showing). Same
    // short-window idea as Priority 2, so the client sees the "missed
    // session, rebook free" card instead of it just disappearing the
    // instant the appointment gets canceled out from under them.
    if (!appt) {
      const RECENT_NOSHOW_WINDOW_HOURS = 48;
      const cutoff = new Date(Date.now() - RECENT_NOSHOW_WINDOW_HOURS * 60 * 60 * 1000);
      appt = await Appointment.findOne({
        where: {
          userId,
          status: "canceled",
          noShowReportedAt: { [Op.ne]: null },
          status_changed_at: { [Op.gte]: cutoff },
        },
        include: includeOpts,
        order: [["status_changed_at", "DESC"]],
      });
    }

    // Priority 3a (fallback): the DIETITIAN cancelled it (free days were
    // added). Shown for 48h with the same "pick a new time" card.
    if (!appt) {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      appt = await Appointment.findOne({
        where: {
          userId,
          status: "canceled",
          noShowBonusDays: { [Op.gt]: 0 },
          noShowReportedAt: null,
          clientNoShowAt: null,
          status_changed_at: { [Op.gte]: cutoff },
        },
        include: includeOpts,
        order: [["status_changed_at", "DESC"]],
      });
    }

    // Priority 3b (fallback): the CLIENT missed the session (dietitian
    // tapped "Client didn't join", or Meet attendance showed only the
    // dietitian). Shown for 48h so she sees "you missed this session"
    // and what to do next, instead of the card silently disappearing.
    if (!appt) {
      const RECENT_CLIENT_NOSHOW_WINDOW_HOURS = 48;
      const cutoff = new Date(Date.now() - RECENT_CLIENT_NOSHOW_WINDOW_HOURS * 60 * 60 * 1000);
      appt = await Appointment.findOne({
        where: {
          userId,
          status: "canceled",
          clientNoShowAt: { [Op.ne]: null },
          status_changed_at: { [Op.gte]: cutoff },
        },
        include: includeOpts,
        order: [["status_changed_at", "DESC"]],
      });
    }

    // Priority 4 (fallback): the dietitian never even confirmed the
    // booking and it auto-expired (see resolveUnconfirmedExpiry). Same
    // short-window idea as Priority 3, but for "never confirmed" rather
    // than "confirmed but didn't show" — the client sees a "please
    // reschedule" card instead of the booking just vanishing.
    if (!appt) {
      const RECENT_EXPIRED_WINDOW_HOURS = 48;
      const cutoff = new Date(Date.now() - RECENT_EXPIRED_WINDOW_HOURS * 60 * 60 * 1000);
      appt = await Appointment.findOne({
        where: {
          userId,
          status: "canceled",
          expiredAt: { [Op.ne]: null },
          status_changed_at: { [Op.gte]: cutoff },
        },
        include: includeOpts,
        order: [["status_changed_at", "DESC"]],
      });
    }

    if (!appt) {
      return res.json(
        ApiResponse("1", "No active appointment", { appointment: null })
      );
    }

    const dietitian = appt.User || null;
    const dietitianName = dietitian
      ? `${dietitian.firstName || ""} ${dietitian.lastName || ""}`.trim()
      : null;
    // Change-policy state for this package (helper/bookingPolicy.js).
    const policyPlan = await bookingPolicy.planForAppointment(appt);

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
          // Prefer this appointment's OWN frozen snapshot (set at the
          // moment it was confirmed — see appointmentController.js
          // updateAppointment) over the slot's live link. The slot's
          // link is shared across every week's booking into it, so
          // reading it live here would mean a dietitian updating it
          // for one client's week could change what a DIFFERENT
          // client (a different week, same weekly slot) sees too.
          // Falls back to the live slot value only for older bookings
          // confirmed before the snapshot existed. Null until either
          // exists — the client app uses null vs non-null to decide
          // the grey/yellow "Join Meeting" button state.
          dietitionLink: appt.paymentHoldAt
            ? null // on hold: no join link until her payment is confirmed
            : appt.meetLink ||
              (appt.SlotDiet ? appt.SlotDiet.dietitionLink || null : null),
          // Oct 2026: on hold until her payment is confirmed.
          paymentHold: !!appt.paymentHoldAt,
          awaitingConsultant: isAwaitingConsultant(appt),
          // True only for the Priority-3 fallback above: a canceled
          // appointment specifically caused by the dietitian never
          // showing up. Drives the "missed session, rebook free" card
          // state on the client — never true for an ordinary
          // client/dietitian-initiated cancellation.
          noShow: appt.status === "canceled" && !!appt.noShowReportedAt,
          // Oct 2026: confirmed, not started 10+ min after its start time
          // (helper/dietitianLateCheck.js) — "your dietitian is running late".
          dietitianLate: appt.status === "confirmed" && !!appt.dietitianLateAlertAt,
          // Free days added to her package for that missed session.
          noShowBonusDays: appt.noShowBonusDays || 0,
          // She (the client) missed this session; drives the "you missed
          // your session" card. Never true for a dietitian no-show.
          clientNoShow: appt.status === "canceled" && !!appt.clientNoShowAt,
          // Her dietitian cancelled it (free days added).
          dietitianCanceled:
            appt.status === "canceled" &&
            !appt.noShowReportedAt &&
            !appt.clientNoShowAt &&
            (appt.noShowBonusDays || 0) > 0,
          // Session rating: drives the "How was your session?" card on a
          // completed consultation. True once she has rated it.
          reviewed:
            appt.status === "completed"
              ? !!(await db.AppointmentReview.findOne({
                  where: { appointmentId: appt.id },
                  attributes: ["id"],
                }))
              : false,
          // Nov 2026: ask her to rate it in a pop-up: over, not rated, and
          // we know she was in it (Join tap / dietitian said yes / Google).
          askReview:
            appt.status === "completed" &&
            !appt.clientNoShowAt &&
            (!!appt.clientJoinTapAt || appt.attendanceFlag === "dietitian_confirmed" || appt.meetClientAttended === true),
          // True only for the Priority-4 fallback above: a canceled
          // appointment specifically caused by the dietitian never
          // confirming it in time (as opposed to noShow, where she DID
          // confirm but never joined). Drives the "please reschedule"
          // card state on the client.
          expired: appt.status === "canceled" && !!appt.expiredAt,
          // Change policy: reschedule only until 24h before; inside 24h
          // she may cancel only while her one free late change is unused.
          lateChangeAvailable: bookingPolicy.lateChangeAvailable(policyPlan),
          bookingLocked: bookingPolicy.bookingLocked(policyPlan),
          lateChangeHours: bookingPolicy.LATE_CHANGE_HOURS,
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

    // Change policy: cancelling inside 24h uses her one free late change
    // for this package; once it's used she can't cancel late any more.
    const late = await bookingPolicy.isInsideLateWindow(appt);
    const policyPlan = late ? await bookingPolicy.planForAppointment(appt) : null;
    if (late && !bookingPolicy.lateChangeAvailable(policyPlan)) {
      return res.json(
        ApiResponse("0", bookingPolicy.MSG.noLateChange, { code: "LATE_CHANGE_USED" })
      );
    }

    appt.status = "canceledByUser";
    appt.completed_by = userId;
    appt.status_changed_at = new Date();
    await appt.save();

    if (late && policyPlan) {
      try {
        policyPlan.lateChangeUsedAt = new Date();
        await policyPlan.save();
      } catch (e) {
        console.error("[consultationBooking] lateChangeUsedAt save failed:", e);
      }
    }

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
            body: await (async () => {
              // Nov 2026: day AND time, so she knows which session.
              const st = await bookingPolicy.sessionStart(appt).catch(() => null);
              return `${clientName || "A client"} canceled their consultation on ${toIsoDate(appt.date)}` +
                (st ? ` at ${bookingPolicy.formatPkTime(st)}` : "") + ". That time is free again.";
            })(),
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


// POST /appointment/:id/client-no-show
// The DIETITIAN reports that the client never joined. Manual backup for
// the automatic Meet attendance check (which only runs after the call
// ends, and only once the dietitian's Google account is linked).
// Allowed from NO_SHOW_GRACE_MINUTES after the start time. Cancels the
// booking without using up her consultation and asks her to rebook.
// POST /appointment/:id/join-tap: the client tapped "Join Meeting" in the
// app (Oct 2026). Stores the FIRST tap only; attendance for dietitians
// whose Google account isn't linked comes from these taps. Own bookings
// only, and only around the call (no taps on old / cancelled ones).
exports.recordJoinTap = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const appt = await db.Appointment.findByPk(req.params.id);
    if (!appt || Number(appt.userId) !== Number(userId)) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }
    if (["canceled", "canceledByUser"].includes(appt.status)) {
      return res.json(ApiResponse("0", "This consultation was cancelled", {}));
    }
    // Nov 2026: the comment above promised "only around the call", but any
    // tap was saved, so a tap days early counted as "she joined". Saved only
    // from 15 min before the start until the session's end.
    {
      const slot = await bookingPolicy.slotFor(appt);
      const st = bookingPolicy.sessionStartSync(appt, slot);
      const en = bookingPolicy.sessionEnd(appt, slot);
      const now = Date.now();
      if ((st && now < st.getTime() - 15 * 60000) || (en && now > en.getTime() + 15 * 60000)) {
        return res.json(ApiResponse("1", "Not saved (outside the session time)", { clientJoinTapAt: appt.clientJoinTapAt }));
      }
    }
    // First tap = she joined. Every tap is counted (Nov 2026): a later tap
    // means she rejoined after dropping out.
    const nowTap = new Date();
    const firstTap = !appt.clientJoinTapAt;
    if (firstTap) appt.clientJoinTapAt = nowTap;
    appt.clientLastJoinTapAt = nowTap;
    appt.clientJoinTapCount = (appt.clientJoinTapCount || 0) + 1;
    await appt.save();
    // Nov 2026: she's waiting and the dietitian hasn't started yet: tell
    // the dietitian now (once), instead of only after 5 minutes late.
    if (firstTap && appt.status === "confirmed") {
      try {
        const [client, dietitian] = await Promise.all([
          User.findByPk(appt.userId, { attributes: ["firstName", "lastName"] }),
          User.findByPk(appt.dietitionId, { attributes: ["deviceToken"] }),
        ]);
        if (dietitian && dietitian.deviceToken) {
          const nm = (client && `${client.firstName || ""} ${client.lastName || ""}`.trim()) || "Your client";
          const st = await bookingPolicy.sessionStart(appt).catch(() => null);
          await sendNotification(
            [dietitian.deviceToken],
            {
              title: `${nm} is waiting for you`,
              body:
                (st ? `Her ${bookingPolicy.formatPkTime(st)} session. ` : "") +
                'Tap "Start session & join call" when you\'re ready.',
            },
            { type: "clientWaiting", appointmentId: String(appt.id) }
          );
        }
      } catch (e) {
        console.error("[recordJoinTap] waiting push:", e.message);
      }
    }
    return res.json(ApiResponse("1", "Saved", { clientJoinTapAt: appt.clientJoinTapAt }));
  } catch (err) {
    console.error("[recordJoinTap]", err.message);
    return res.status(500).json(ApiResponse("0", "Could not save", {}));
  }
};

// POST /appointment/:id/app-return { at? }: she came back to Fit Her after
// tapping Join (Nov 2026). That is our "she left the call" time. `at` is
// when the app saw her return (sent later if the app was closed); it must
// be after her last Join tap and not in the future. Latest return wins.
// Ignored when she was back within a minute (the call hadn't started).
exports.recordAppReturn = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    const appt = await db.Appointment.findByPk(req.params.id);
    if (!appt || Number(appt.userId) !== Number(userId)) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }
    const lastTap = appt.clientLastJoinTapAt || appt.clientJoinTapAt;
    if (!lastTap) return res.json(ApiResponse("1", "Not saved (no Join tap)", {}));
    const now = Date.now();
    let at = req.body && req.body.at ? new Date(req.body.at) : new Date(now);
    if (isNaN(at.getTime()) || at.getTime() > now + 60000) at = new Date(now);
    const sinceTap = (at.getTime() - new Date(lastTap).getTime()) / 60000;
    if (sinceTap < 1) return res.json(ApiResponse("1", "Not saved (too soon)", {}));
    const slot = await bookingPolicy.slotFor(appt);
    const end = bookingPolicy.sessionEnd(appt, slot);
    if (end && at.getTime() > end.getTime() + 60 * 60000) {
      return res.json(ApiResponse("1", "Not saved (long after the session)", {}));
    }
    if (!appt.clientReturnedAt || at > new Date(appt.clientReturnedAt)) {
      appt.clientReturnedAt = at;
      await appt.save();
    }
    return res.json(ApiResponse("1", "Saved", { clientReturnedAt: appt.clientReturnedAt }));
  } catch (err) {
    console.error("[recordAppReturn]", err.message);
    return res.status(500).json(ApiResponse("0", "Could not save", {}));
  }
};

// POST /appointment/:id/client-joined: the dietitian answers "Yes, she
// joined" after a call where the client never tapped Join in the app
// (Oct 2026). Own appointment (or admin). "No" uses /client-no-show.
exports.confirmClientJoined = async (req, res) => {
  try {
    const actorId = req.user && req.user.id;
    const appt = await db.Appointment.findByPk(req.params.id);
    if (!appt) return res.json(ApiResponse("0", "Appointment not found", {}));
    const isOwn = Number(appt.dietitionId) === Number(actorId);
    const isAdmin = String(req.user.userType || "").trim().toLowerCase() === "admin";
    if (!isOwn && !isAdmin) return res.json(ApiResponse("0", "Not your appointment", {}));
    if (!["In Progress", "completed"].includes(appt.status)) {
      return res.json(ApiResponse("0", "This consultation hasn't happened yet", {}));
    }
    appt.meetClientAttended = true;
    if (appt.attendanceFlag !== "tap_without_google") appt.attendanceFlag = "dietitian_confirmed";
    // Nov 2026: "about how long?" (minutes), optional.
    const mins = parseInt(req.body && req.body.minutes, 10);
    if (Number.isInteger(mins) && mins > 0 && mins <= 180) appt.dietitianReportedMinutes = mins;
    await appt.save();
    // Nov 2026: now we know she was there → ask her to rate it.
    if (appt.status === "completed") {
      require("../../helper/consultReviewAsk").askForReview(appt.id).catch(() => {});
    }
    return res.json(ApiResponse("1", "Thanks, noted", { appointment: appt.toJSON() }));
  } catch (err) {
    console.error("[confirmClientJoined]", err.message);
    return res.json(ApiResponse("0", "Could not update. Please try again.", {}));
  }
};

exports.reportClientNoShow = async (req, res) => {
  try {
    const actorId = req.user && req.user.id;
    if (!actorId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const apptId = parseInt(req.params.id, 10);
    if (!Number.isInteger(apptId) || apptId <= 0) {
      return res.json(ApiResponse("0", "Invalid appointment id", {}));
    }
    const appt = await Appointment.findByPk(apptId);
    if (!appt) return res.json(ApiResponse("0", "Appointment not found", {}));

    const isOwnDietitian = Number(appt.dietitionId) === Number(actorId);
    const isAdmin = String(req.user.userType || "").trim().toLowerCase() === "admin";
    if (!isOwnDietitian && !isAdmin) {
      return res.json(ApiResponse("0", "Not your appointment", {}));
    }
    if (appt.clientNoShowAt) {
      return res.json(ApiResponse("1", "Already marked", { appointment: appt.toJSON() }));
    }
    if (!["confirmed", "In Progress", "completed"].includes(appt.status)) {
      return res.json(ApiResponse("0", "This consultation can't be marked as missed", {}));
    }
    const realStart = await bookingPolicy.sessionStart(appt);
    const minutesSinceStart = realStart
      ? (Date.now() - realStart.getTime()) / 60000
      : (Date.now() - new Date(appt.date).getTime()) / 60000;
    if (minutesSinceStart < NO_SHOW_GRACE_MINUTES) {
      const wait = Math.ceil(NO_SHOW_GRACE_MINUTES - minutesSinceStart);
      return res.json(
        ApiResponse("0", `Please give her ${wait} more minute${wait === 1 ? "" : "s"} to join.`, {})
      );
    }

    await resolveClientNoShow(appt, { actorUserId: actorId });
    try {
      await createEscalation({
        userId: appt.userId,
        dietitianId: appt.dietitionId,
        trigger: "CONSULT_CLIENT_NO_SHOW",
        severity: "low",
        payload: { appointmentId: appt.id, scheduledDate: appt.date, detectedVia: "dietitian" },
      });
    } catch (e) {
      console.error("[consultationBooking] client no-show escalation failed:", e);
    }
    return res.json(ApiResponse("1", "Marked as missed. She's been asked to rebook.", { appointment: appt.toJSON() }));
  } catch (err) {
    console.error("[consultationBooking] reportClientNoShow:", err);
    return res.json(ApiResponse("0", "Could not update. Please try again.", {}));
  }
};
