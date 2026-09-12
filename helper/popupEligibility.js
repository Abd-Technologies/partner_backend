const { Op } = require("sequelize");
const moment = require("moment-timezone");
const {
  Appointment,
  ClassAttendance,
  DailyCheckin,
  Day7Review,
  MealLog,
  PdfDietsForUserNew,
  PendingPopupState,
  PreConsultationProfile,
  ProgressSubmission,
  UserPlan,
  Plan,
} = require("../models");
const { createEscalation } = require("./escalation");

const TZ = "Asia/Karachi";

// Authoritative "what kind of plan is this" checks — prefer
// Plan.planType (migration 20260902000001-add-plan-type-to-plans),
// falling back to a title-text guess only for plans not yet backfilled.
// The inline checks these replace were all named "dietOrCombined" but
// only ever tested for the word "diet" — a plan titled e.g. "Both"
// with no "diet"/"combined" substring was silently missed. Fixed here
// too, in the fallback branch.
function isDietOrCombinedPlan(p) {
  if (!p || !p.Plan) return false;
  const type = p.Plan.planType;
  if (type) return type === "diet" || type === "combined";
  const title = (p.Plan.title || "").toLowerCase();
  return (
    title.includes("diet") || title.includes("combined") || title.includes("both")
  );
}

function isWorkoutOrCombinedPlan(p) {
  if (!p || !p.Plan) return false;
  const type = p.Plan.planType;
  if (type) return type === "workout" || type === "combined";
  const title = (p.Plan.title || "").toLowerCase();
  return (
    title.includes("workout") || title.includes("combined") || title.includes("both")
  );
}

// Priority order — highest first. Section G.1 of the build plan.
const PRIORITY = [
  "POPUP_MEDICAL_CONCERN",
  "POPUP_CONSULTANT_NO_SHOW",
  "POPUP_PLAN_DELAYED",
  "POPUP_DAY30_PROGRESS",
  "POPUP_DAY15_PROGRESS",
  "POPUP_DAY7_REVIEW",
  "POPUP_BOOK_FOLLOWUP_CONSULTATION",
  "POPUP_BOOK_INITIAL_CONSULTATION",
  "POPUP_PRE_CONSULTATION_FORM",
  "POPUP_BOOK_INITIAL_REMINDER",
  "POPUP_EARLY_CHECKIN",
  "POPUP_INACTIVITY_REMINDER",
  "POPUP_DAILY_LOG_REMINDER",
  "POPUP_RENEW_PLAN",
];

const MAX_BOOKING_REMINDERS = 5;
const DAILY_LOG_REMINDER_THRESHOLD_DAYS = 2;
const INACTIVITY_THRESHOLD_DAYS = 3;
const INACTIVITY_REFIRE_DAYS = 3;
const RENEW_PLAN_REFIRE_DAYS = 7;
const PLAN_DELAY_BREACH_DAYS = 3;
const EARLY_CHECKIN_DAY_LOW = 3;
const EARLY_CHECKIN_DAY_HIGH = 4;
const NO_SHOW_GRACE_MINUTES = 10;

// Day-of-cycle each popup fires (relative to plan delivery).
const DAY7_OFFSET = 7;
const DAY15_OFFSET = 15;
const DAY30_OFFSET = 30;

function nowPkt() {
  return moment.tz(TZ);
}

function daysSince(date) {
  if (!date) return null;
  const m = moment.tz(date, TZ).startOf("day");
  const today = nowPkt().startOf("day");
  return today.diff(m, "days");
}

// Upsert a PendingPopupState row to mark a popup eligible. Idempotent —
// if the row exists with completedAt=null we update; if completedAt is
// set (popup retired for this cycle), we do NOT re-eligible until the
// caller passes a metadata cycle that differs from the retired one.
async function setEligible(userId, variable, eligibleAt, metadata) {
  const cycleKey =
    metadata && (metadata.cycle != null ? String(metadata.cycle) : null);

  // Find the most recent row for this (user, variable). If completed and
  // for the same cycle, skip. Else upsert/create.
  const recent = await PendingPopupState.findOne({
    where: { userId, popupVariable: variable },
    order: [["createdAt", "DESC"]],
  });

  if (recent && recent.completedAt) {
    const recentCycle =
      recent.metadata && recent.metadata.cycle != null
        ? String(recent.metadata.cycle)
        : null;
    // Same cycle already completed → don't resurrect it.
    if (cycleKey != null && recentCycle === cycleKey) return null;
    // Different (later) cycle → fall through and create a fresh row.
  }

  if (recent && !recent.completedAt) {
    if (
      !recent.eligibleAt ||
      moment(recent.eligibleAt).valueOf() !== moment(eligibleAt).valueOf()
    ) {
      await recent.update({ eligibleAt, metadata });
    }
    return recent;
  }

  return PendingPopupState.create({
    userId,
    popupVariable: variable,
    eligibleAt,
    metadata,
  });
}

// ── Per-popup evaluators ───────────────────────────────────────────────

async function evalBookInitialConsultation(user, plans) {
  // Diet/Combined plans only. Trigger: plan purchased AND no initial
  // Appointment of kind='initial' yet (or any appointment if kind not
  // wired — backward compat). Stops once initial booking exists.
  const dietOrCombined = plans.find(isDietOrCombinedPlan);
  if (!dietOrCombined) return;

  const initial = await Appointment.findOne({
    where: {
      userId: user.id,
      [Op.or]: [{ kind: "initial" }, { kind: null }],
      status: { [Op.in]: ["pending", "confirmed", "In Progress", "completed"] },
    },
  });
  if (initial) return;

  await setEligible(
    user.id,
    "POPUP_BOOK_INITIAL_CONSULTATION",
    nowPkt().toDate(),
    { userPlanId: dietOrCombined.id }
  );
}

async function evalPreConsultationForm(user, plans) {
  const dietOrCombined = plans.find(isDietOrCombinedPlan);
  if (!dietOrCombined) return;

  const initial = await Appointment.findOne({
    where: {
      userId: user.id,
      [Op.or]: [{ kind: "initial" }, { kind: null }],
      status: { [Op.in]: ["pending", "confirmed", "In Progress"] },
    },
  });
  if (!initial) return;

  const profile = await PreConsultationProfile.findOne({
    where: { userId: user.id },
  });
  if (profile && profile.isComplete) return;

  await setEligible(
    user.id,
    "POPUP_PRE_CONSULTATION_FORM",
    nowPkt().toDate(),
    { appointmentId: initial.id }
  );
}

async function evalBookInitialReminder(user, plans) {
  // Every 2 days while the initial consultation isn't booked, max 5.
  // After 5 dismissals → BOOKING_REMINDER_5X escalation.
  const dietOrCombined = plans.find(isDietOrCombinedPlan);
  if (!dietOrCombined) return;

  const initial = await Appointment.findOne({
    where: {
      userId: user.id,
      status: { [Op.in]: ["pending", "confirmed", "In Progress", "completed"] },
    },
  });
  if (initial) return;

  const purchaseDate = dietOrCombined.buyingDate;
  if (!purchaseDate) return;
  const sincePurchaseDays = daysSince(purchaseDate);
  if (sincePurchaseDays < 2) return; // first reminder fires Day 2

  const recent = await PendingPopupState.findOne({
    where: {
      userId: user.id,
      popupVariable: "POPUP_BOOK_INITIAL_REMINDER",
    },
    order: [["createdAt", "DESC"]],
  });

  if (recent && recent.dismissCount >= MAX_BOOKING_REMINDERS) {
    // Trip the 5x escalation once, then stop nagging.
    if (!recent.metadata || !recent.metadata.escalated) {
      try {
        await createEscalation({
          userId: user.id,
          dietitianId: null,
          trigger: "BOOKING_REMINDER_5X",
          severity: "medium",
          payload: { userPlanId: dietOrCombined.id },
        });
        await recent.update({
          metadata: { ...(recent.metadata || {}), escalated: true },
        });
      } catch (e) {
        console.error("[popupEligibility] BOOKING_REMINDER_5X escalate:", e);
      }
    }
    return;
  }

  // Re-eligible cadence: every 2 days since lastShownAt.
  const lastShown = recent && recent.lastShownAt;
  if (lastShown) {
    const daysSinceShown = daysSince(lastShown);
    if (daysSinceShown < 2) return;
  }

  await setEligible(
    user.id,
    "POPUP_BOOK_INITIAL_REMINDER",
    nowPkt().toDate(),
    { userPlanId: dietOrCombined.id }
  );
}

async function evalEarlyCheckin(user, plans) {
  // 3-4 days after firstPlanDeliveredAt (cycle 1) or latestPlanDeliveredAt
  // (cycle 2). One per cycle.
  const plan = plans.find((p) => p.firstPlanDeliveredAt);
  if (!plan) return;

  // Cycle 2 anchor = latestPlanDeliveredAt if it differs from first.
  const anchors = [];
  if (plan.firstPlanDeliveredAt) {
    anchors.push({ at: plan.firstPlanDeliveredAt, cycle: 1 });
  }
  if (
    plan.latestPlanDeliveredAt &&
    moment(plan.latestPlanDeliveredAt).valueOf() !==
      moment(plan.firstPlanDeliveredAt).valueOf()
  ) {
    anchors.push({ at: plan.latestPlanDeliveredAt, cycle: 2 });
  }

  for (const a of anchors) {
    const since = daysSince(a.at);
    if (since == null) continue;
    if (since >= EARLY_CHECKIN_DAY_LOW && since <= EARLY_CHECKIN_DAY_HIGH) {
      await setEligible(
        user.id,
        "POPUP_EARLY_CHECKIN",
        nowPkt().toDate(),
        { userPlanId: plan.id, cycle: a.cycle }
      );
    }
  }
}

async function evalDay7Review(user, plans) {
  const plan = plans.find((p) => p.firstPlanDeliveredAt);
  if (!plan) return;

  const cycles = [];
  if (plan.firstPlanDeliveredAt) {
    cycles.push({ at: plan.firstPlanDeliveredAt, cycle: 1 });
  }
  if (
    plan.latestPlanDeliveredAt &&
    moment(plan.latestPlanDeliveredAt).valueOf() !==
      moment(plan.firstPlanDeliveredAt).valueOf()
  ) {
    cycles.push({ at: plan.latestPlanDeliveredAt, cycle: 2 });
  }

  for (const c of cycles) {
    const since = daysSince(c.at);
    if (since == null || since < DAY7_OFFSET) continue;

    const existing = await Day7Review.findOne({
      where: { userPlanId: plan.id, cycle: c.cycle },
    });
    if (existing) continue;

    await setEligible(
      user.id,
      "POPUP_DAY7_REVIEW",
      nowPkt().toDate(),
      { userPlanId: plan.id, cycle: c.cycle }
    );
  }
}

async function evalDay15Progress(user, plans) {
  const plan = plans.find((p) => p.firstPlanDeliveredAt);
  if (!plan) return;
  const since = daysSince(plan.firstPlanDeliveredAt);
  if (since == null || since < DAY15_OFFSET) return;

  const existing = await ProgressSubmission.findOne({
    where: { userPlanId: plan.id, cycle: 15 },
  });
  if (existing) return;

  await setEligible(
    user.id,
    "POPUP_DAY15_PROGRESS",
    nowPkt().toDate(),
    { userPlanId: plan.id, cycle: 15 }
  );
}

async function evalBookFollowup(user, plans) {
  const plan = plans.find((p) => p.firstPlanDeliveredAt);
  if (!plan) return;

  const day15 = await ProgressSubmission.findOne({
    where: { userPlanId: plan.id, cycle: 15 },
  });
  if (!day15) return;

  const followup = await Appointment.findOne({
    where: {
      userId: user.id,
      kind: "followup",
      status: { [Op.in]: ["pending", "confirmed", "In Progress", "completed"] },
    },
  });
  if (followup) return;

  await setEligible(
    user.id,
    "POPUP_BOOK_FOLLOWUP_CONSULTATION",
    nowPkt().toDate(),
    { userPlanId: plan.id }
  );
}

async function evalDay30Progress(user, plans) {
  const plan = plans.find((p) => p.firstPlanDeliveredAt);
  if (!plan) return;
  const since = daysSince(plan.firstPlanDeliveredAt);
  if (since == null || since < DAY30_OFFSET) return;

  const existing = await ProgressSubmission.findOne({
    where: { userPlanId: plan.id, cycle: 30 },
  });
  if (existing) return;

  await setEligible(
    user.id,
    "POPUP_DAY30_PROGRESS",
    nowPkt().toDate(),
    { userPlanId: plan.id, cycle: 30 }
  );
}

async function evalRenewPlan(user, plans) {
  const plan = plans.find((p) => p.firstPlanDeliveredAt);
  if (!plan) return;

  const day30 = await ProgressSubmission.findOne({
    where: { userPlanId: plan.id, cycle: 30 },
  });
  if (!day30) return;

  // Throttle: don't re-fire if shown in the last 7 days. Renewals are
  // a calm decision; weekly nag matches the client cooldown. We push
  // eligibleAt forward to (lastShown + 7d) so listForUser hides the row
  // until the throttle expires — skipping setEligible alone wouldn't
  // help because the existing row's eligibleAt is already in the past.
  const recent = await PendingPopupState.findOne({
    where: { userId: user.id, popupVariable: "POPUP_RENEW_PLAN" },
    order: [["createdAt", "DESC"]],
  });
  const lastShown = recent && recent.lastShownAt;
  if (lastShown && daysSince(lastShown) < RENEW_PLAN_REFIRE_DAYS) {
    const nextEligible = moment(lastShown)
      .tz(TZ)
      .add(RENEW_PLAN_REFIRE_DAYS, "days")
      .toDate();
    if (
      recent.eligibleAt &&
      moment(recent.eligibleAt).isBefore(nextEligible)
    ) {
      await recent.update({ eligibleAt: nextEligible });
    }
    return;
  }

  // Eligible from Day 30 onwards while plan is still active.
  await setEligible(user.id, "POPUP_RENEW_PLAN", nowPkt().toDate(), {
    userPlanId: plan.id,
  });
}

async function evalDailyLogReminder(user) {
  // 2+ consecutive days with no daily check-in.
  const today = nowPkt().startOf("day");
  const since = today.clone().subtract(7, "days").format("YYYY-MM-DD");
  const recent = await DailyCheckin.findAll({
    where: { userId: user.id, date: { [Op.gte]: since } },
    attributes: ["date"],
    order: [["date", "DESC"]],
    limit: 7,
  });
  const lastDate = recent[0] && recent[0].date;
  const gap = lastDate
    ? today.diff(moment.tz(lastDate, TZ).startOf("day"), "days")
    : 999;

  if (gap < DAILY_LOG_REMINDER_THRESHOLD_DAYS) return;

  // Cap at 3 dismissals (per Section 11 frequency rule).
  const recentRow = await PendingPopupState.findOne({
    where: { userId: user.id, popupVariable: "POPUP_DAILY_LOG_REMINDER" },
    order: [["createdAt", "DESC"]],
  });
  if (recentRow && recentRow.dismissCount >= 3 && !recentRow.completedAt) {
    return;
  }

  await setEligible(
    user.id,
    "POPUP_DAILY_LOG_REMINDER",
    nowPkt().toDate(),
    { gapDays: gap }
  );
}

async function evalInactivityReminder(user, plans) {
  // 3+ consecutive days no slot join. Workout/combined plans only.
  const isWorkoutOrCombined = plans.some(isWorkoutOrCombinedPlan);
  if (!isWorkoutOrCombined) return;

  const since = nowPkt()
    .startOf("day")
    .subtract(INACTIVITY_THRESHOLD_DAYS, "days")
    .format("YYYY-MM-DD");
  const recentAttendance = await ClassAttendance.findOne({
    where: { user_id: user.id, attended_at: { [Op.gte]: since } },
  });
  if (recentAttendance) return;

  // Throttle: don't re-fire if shown in the last 3 days. We push
  // eligibleAt forward to (lastShown + 3d) so listForUser hides the row
  // until the throttle expires — skipping setEligible alone wouldn't
  // help because the existing row's eligibleAt is already in the past.
  const recentState = await PendingPopupState.findOne({
    where: { userId: user.id, popupVariable: "POPUP_INACTIVITY_REMINDER" },
    order: [["createdAt", "DESC"]],
  });
  const lastShown = recentState && recentState.lastShownAt;
  if (lastShown && daysSince(lastShown) < INACTIVITY_REFIRE_DAYS) {
    const nextEligible = moment(lastShown)
      .tz(TZ)
      .add(INACTIVITY_REFIRE_DAYS, "days")
      .toDate();
    if (
      recentState.eligibleAt &&
      moment(recentState.eligibleAt).isBefore(nextEligible)
    ) {
      await recentState.update({ eligibleAt: nextEligible });
    }
    return;
  }

  await setEligible(
    user.id,
    "POPUP_INACTIVITY_REMINDER",
    nowPkt().toDate(),
    { thresholdDays: INACTIVITY_THRESHOLD_DAYS }
  );
}

async function evalPlanDelayed(user, plans) {
  // Day 3 after consultation, no PdfDiet delivered for that plan.
  const dietOrCombined = plans.find(isDietOrCombinedPlan);
  if (!dietOrCombined) return;

  const consultation = await Appointment.findOne({
    where: {
      userId: user.id,
      status: "completed",
    },
    order: [["status_changed_at", "DESC"]],
  });
  if (!consultation) return;
  const completedAt = consultation.status_changed_at || consultation.updatedAt;
  if (!completedAt) return;
  const sinceDays = daysSince(completedAt);
  if (sinceDays == null || sinceDays < PLAN_DELAY_BREACH_DAYS) return;

  // Already delivered? Skip.
  const pdf = await PdfDietsForUserNew.findOne({
    where: { userPlanId: dietOrCombined.id },
  });
  if (pdf) return;

  // Open the popup AND open an escalation if not already open. The
  // dedup happens via PendingPopupState's recent-row check.
  const existing = await PendingPopupState.findOne({
    where: {
      userId: user.id,
      popupVariable: "POPUP_PLAN_DELAYED",
      completedAt: null,
    },
  });
  if (!existing) {
    try {
      await createEscalation({
        userId: user.id,
        dietitianId: consultation.dietitionId || null,
        trigger: "PLAN_DELAYED",
        severity: "high",
        payload: {
          appointmentId: consultation.id,
          userPlanId: dietOrCombined.id,
          daysSinceConsultation: sinceDays,
        },
      });
    } catch (e) {
      console.error("[popupEligibility] PLAN_DELAYED escalate:", e);
    }
  }

  await setEligible(
    user.id,
    "POPUP_PLAN_DELAYED",
    nowPkt().toDate(),
    { appointmentId: consultation.id, daysSinceConsultation: sinceDays }
  );
}

// ── Orchestrator ──────────────────────────────────────────────────────

// Evaluate every popup for one user. Called by:
//   - the hourly cron (mass refresh)
//   - on-demand from /users/home/dashboard so a freshly-purchased user
//     sees the booking popup immediately without waiting for the cron.
async function evaluateForUser(userId) {
  try {
    const plans = await UserPlan.findAll({
      where: {
        userId,
        status: true,
        expireDate: { [Op.gte]: new Date() },
      },
      include: [{ model: Plan, attributes: ["id", "title", "CategoryId"] }],
    });
    if (plans.length === 0) return;

    const user = { id: userId };

    // Order doesn't matter for evaluation; priority happens on read.
    await evalBookInitialConsultation(user, plans);
    await evalPreConsultationForm(user, plans);
    await evalBookInitialReminder(user, plans);
    await evalEarlyCheckin(user, plans);
    await evalDay7Review(user, plans);
    await evalDay15Progress(user, plans);
    await evalBookFollowup(user, plans);
    await evalDay30Progress(user, plans);
    await evalRenewPlan(user, plans);
    await evalDailyLogReminder(user);
    await evalInactivityReminder(user, plans);
    await evalPlanDelayed(user, plans);

    // Note: POPUP_CONSULTANT_NO_SHOW is fired by a separate per-minute
    // cron (see app.js) since it's time-sensitive at the minute level.
    // POPUP_MEDICAL_CONCERN and POPUP_PHOTO_PRIVACY_NOTICE are
    // user-driven, not auto-eligible.
  } catch (err) {
    console.error("[popupEligibility] evaluateForUser failed:", err);
  }
}

// Read API used by the dashboard. Returns the active pending popups for
// a user, sorted by priority. Capped at 5 entries (build plan G.3).
async function listForUser(userId, limit = 5) {
  const rows = await PendingPopupState.findAll({
    where: {
      userId,
      eligibleAt: { [Op.lte]: new Date(), [Op.ne]: null },
      completedAt: null,
    },
  });

  // Group by variable, keep the most recent eligibleAt per variable.
  const byVar = new Map();
  for (const r of rows) {
    const cur = byVar.get(r.popupVariable);
    if (!cur || moment(r.eligibleAt).isAfter(cur.eligibleAt)) {
      byVar.set(r.popupVariable, r);
    }
  }

  const list = Array.from(byVar.values());
  list.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.popupVariable);
    const bi = PRIORITY.indexOf(b.popupVariable);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return list.slice(0, limit).map((r) => ({
    variable: r.popupVariable,
    eligibleAt: r.eligibleAt,
    dismissCount: r.dismissCount || 0,
    metadata: r.metadata || null,
  }));
}

// Bulk evaluator used by the hourly cron. Walks every user with an
// active plan. Sequential so we don't hammer the DB; the volume is
// small enough that this completes in seconds.
async function evaluateAllActiveUsers() {
  const plans = await UserPlan.findAll({
    where: {
      status: true,
      expireDate: { [Op.gte]: new Date() },
    },
    attributes: ["userId"],
    group: ["userId"],
  });
  for (const p of plans) {
    await evaluateForUser(p.userId);
  }
}

// Per-minute consultant-no-show check. Looks for confirmed appointments
// whose scheduled time + 10 min has passed without an actualStartedAt
// (status didn't flip to "In Progress"). Fires the popup eligibility AND
// opens a CONSULT_NO_SHOW escalation. Idempotent on PendingPopupState.
async function evaluateConsultantNoShows() {
  const cutoff = nowPkt().subtract(NO_SHOW_GRACE_MINUTES, "minutes").toDate();
  const rows = await Appointment.findAll({
    where: {
      status: "confirmed",
      date: { [Op.lte]: cutoff },
      noShowReportedAt: null,
    },
  });
  for (const a of rows) {
    try {
      await setEligible(
        a.userId,
        "POPUP_CONSULTANT_NO_SHOW",
        nowPkt().toDate(),
        { appointmentId: a.id, scheduledDate: a.date }
      );
    } catch (e) {
      console.error("[popupEligibility] no-show set eligible:", e);
    }
  }
}

module.exports = {
  evaluateForUser,
  evaluateAllActiveUsers,
  evaluateConsultantNoShows,
  listForUser,
  PRIORITY,
};
