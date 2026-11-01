const { Op } = require("sequelize");
const moment = require("moment-timezone");
const {
  Appointment,
  ClassAttendance,
  DailyCheckin,
  Day7Review,
  DietPlan,
  MealLog,
  PdfDietsForUserNew,
  PendingPopupState,
  PreConsultationProfile,
  ProgressSubmission,
  User,
  UserPlan,
  Plan,
} = require("../models");
const sendNotification = require("./notification");
const { createEscalation } = require("./escalation");
const { resolveDietitianNoShow, resolveUnconfirmedExpiry } = require("./noShowResolution");

const { requirementsFor } = require("./preConsultRequirements");
const TZ = "Asia/Karachi";

// Authoritative "what kind of plan is this" checks — prefer
// Plan.planType (migration 20260902000001-add-plan-type-to-plans),
// falling back to a title-text guess only for plans not yet backfilled.
// The inline checks these replace were all named "dietOrCombined" but
// only ever tested for the word "diet" — a plan titled e.g. "Both"
// with no "diet"/"combined" substring was silently missed. Fixed here
// too, in the fallback branch.
// Oct 2026: one shared answer (helper/planKind.js): planType, then the
// plan's category, then its title.
const { hasDiet: planHasDiet, hasWorkout: planHasWorkout } = require("./planKind");

function isDietOrCombinedPlan(p) {
  return !!(p && p.Plan && planHasDiet(p.Plan));
}

function isWorkoutOrCombinedPlan(p) {
  return !!(p && p.Plan && planHasWorkout(p.Plan));
}

// Priority order — highest first. Section G.1 of the build plan.
const PRIORITY = [
  "POPUP_MEDICAL_CONCERN",
  // Set by helper/autoCancelLateClasses.js when a class never started.
  "POPUP_CLASS_CANCELLED",
  // Dietitian/system cancelled her consultation (helper/consultationCancelledPopup.js).
  "POPUP_CONSULTATION_CANCELLED",
  "POPUP_CONSULTANT_NO_SHOW",
  "POPUP_PLAN_DELAYED",
  // Same planned order as the app's pop-up manager (PopupRank, Oct 2026).
  // Health form first: the dietitian needs her answers before the
  // consultation is booked.
  "POPUP_PRE_CONSULTATION_FORM",
  "POPUP_BOOK_INITIAL_CONSULTATION",
  "POPUP_BOOK_INITIAL_REMINDER",
  "POPUP_DAY30_PROGRESS",
  "POPUP_DAY15_PROGRESS",
  "POPUP_DAY7_REVIEW",
  "POPUP_BOOK_FOLLOWUP_CONSULTATION",
  "POPUP_EARLY_CHECKIN",
  "POPUP_INACTIVITY_REMINDER",
  "POPUP_DAILY_LOG_REMINDER",
  "POPUP_RENEW_PLAN",
];

// Removed from the app (Oct 2026). Rows may still be created (some
// carry staff escalations, e.g. plan delayed), but listForUser never
// sends them, so she never sees them.
const HIDDEN_POPUPS = new Set([
  "POPUP_MEDICAL_CONCERN", // not automatic
  "POPUP_CONSULTANT_NO_SHOW", // not working
  "POPUP_PLAN_DELAYED", // low: staff escalation stays
  // Trial moments (helper/trialMoments.js): the app's trial moment
  // controller shows these itself (on both Homes), not this list.
  "POPUP_TRIAL_DAY3",
  "POPUP_TRIAL_DAY4",
  "POPUP_TRIAL_LASTDAY",
  "POPUP_TRIAL_ENDED",
  "POPUP_INACTIVITY_REMINDER", // low: "We miss you"
  "POPUP_DAILY_LOG_REMINDER", // low: "Don't forget to log today"
  // One weekly check-in replaces these three (helper/weeklyCheckin.js).
  // Rows are still made and closed as before; she sees the Home card and
  // the Sunday push instead.
  "POPUP_DAY7_REVIEW",
  "POPUP_DAY15_PROGRESS",
  "POPUP_DAY30_PROGRESS",
]);

const MAX_BOOKING_REMINDERS = 5;
const DAILY_LOG_REMINDER_THRESHOLD_DAYS = 2;
const INACTIVITY_THRESHOLD_DAYS = 3;
const INACTIVITY_REFIRE_DAYS = 3;
const RENEW_PLAN_REFIRE_DAYS = 7;
// Renew + Day 30 check-in open in the package's last N days.
const RENEW_WINDOW_DAYS = 5;
// Plan must reach the client within 48 hours of the consultation ending.
// Measured in real hours (not calendar days) so a 11pm consultation still
// gets its full 48h.
const PLAN_DELAY_BREACH_HOURS = 48;
// Early check-in opens on day 4 after a diet plan is shared and stays
// open until day 6 (so she still gets it if she skips the app on day 4).
const EARLY_CHECKIN_DAY_LOW = 4;
const EARLY_CHECKIN_DAY_HIGH = 6;
const NO_SHOW_GRACE_MINUTES = 10;
// How long a confirmed-but-unreported appointment can stay "eligible"
// for the no-show popup before it's considered stale and auto-retired
// (see evaluateConsultantNoShows). Exported so
// consultationBookingController.js's getMyCurrentAppointment can flag
// the same appointment the exact same way for the Diet tab's
// UpcomingConsultationCard, instead of recomputing this rule twice.
const NO_SHOW_STALE_HOURS = 24;

// Day-of-cycle each popup fires (relative to plan delivery).
const DAY7_OFFSET = 7;
const DAY15_OFFSET = 15;
const DAY30_OFFSET = 30;

function nowPkt() {
  return moment.tz(TZ);
}

// Whole days until a date (0 = today), or null.
function daysLeft(date) {
  if (!date) return null;
  const end = moment.tz(date, TZ).startOf("day");
  return end.diff(nowPkt().startOf("day"), "days");
}

function daysSince(date) {
  if (!date) return null;
  const m = moment.tz(date, TZ).startOf("day");
  const today = nowPkt().startOf("day");
  return today.diff(m, "days");
}

// Phone (push) notifications for the popups that matter most when she
// ISN'T in the app. Until now these only existed as in-app popups, so a
// client who didn't open the app never heard about her check-in, progress
// update, follow-up or renewal. Each eligible row pushes at most once
// (marked with metadata.pushedAt), and only in the daytime — a row that
// becomes eligible at night is pushed on the first daytime run instead
// (the hourly cron or her next dashboard load).
//
// Deliberately NOT here yet: POPUP_PLAN_DELAYED, POPUP_BOOK_INITIAL_*,
// POPUP_DAILY_LOG_REMINDER, POPUP_INACTIVITY_REMINDER — those would fire
// for every pre-release client on release day until the launch-date
// cutoff is in place. Every popup below needs an AI plan delivered first,
// so none of them can fire for old clients.
const PUSH_ON_ELIGIBLE = {
  // PAUSED (Oct 2026): no phone push for the day 3-4 early check-in, to
  // keep the first week light. The in-app popup still shows. Uncomment
  // to turn the push back on.
  // POPUP_EARLY_CHECKIN: {
  //   title: "Quick check-in",
  //   body: "How are the first few days of your plan going? Tap to tell your dietitian.",
  // },
  // Day 7 / 15 / 30 pushes OFF (Oct 2026): the weekly check-in push
  // (helper/notifications/weeklyCheckin.js) says the same thing.
  // POPUP_DAY7_REVIEW: {
  //   title: "One week in!",
  //   body: "Take a minute to tell your dietitian how your first week went.",
  // },
  // POPUP_DAY15_PROGRESS: {
  //   title: "Day 15 progress check",
  //   body: "Share your progress to unlock your follow-up call and your next plan.",
  // },
  POPUP_BOOK_FOLLOWUP_CONSULTATION: {
    title: "Time for your follow-up",
    body: "Book your follow-up call so your dietitian can update your plan.",
  },
  // POPUP_DAY30_PROGRESS: {
  //   title: "You made it to Day 30!",
  //   body: "Share your progress and see how far you've come.",
  // },
  POPUP_RENEW_PLAN: {
    title: "Keep your momentum going",
    body: "Your plan is coming to an end. Renew to keep your progress on track.",
  },
};
const PUSH_HOUR_FROM = 10; // PKT, inclusive
const PUSH_HOUR_TO = 21; // PKT, exclusive

async function maybePushPopup(row, variable) {
  const copy = PUSH_ON_ELIGIBLE[variable];
  if (!copy || !row || row.completedAt) return;
  const meta = row.metadata || {};
  if (meta.pushedAt) return;
  const hour = nowPkt().hour();
  if (hour < PUSH_HOUR_FROM || hour >= PUSH_HOUR_TO) return; // retry on a later run
  try {
    // Mark first, so a slow or failed send can never cause a repeat push.
    await row.update({ metadata: { ...meta, pushedAt: new Date().toISOString() } });
    const user = await User.findByPk(row.userId, { attributes: ["deviceToken"] });
    if (user && user.deviceToken) {
      await sendNotification([user.deviceToken], copy, {
        type: "popupReminder",
        popupVariable: variable,
      });
    }
  } catch (e) {
    console.error("[popupEligibility] push for", variable, "failed:", e.message);
  }
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
      // Carry the push marker forward so this same row never pushes twice.
      const pushedAt = recent.metadata && recent.metadata.pushedAt;
      await recent.update({
        eligibleAt,
        metadata: pushedAt ? { ...(metadata || {}), pushedAt } : metadata,
      });
    }
    await maybePushPopup(recent, variable);
    return recent;
  }

  const created = await PendingPopupState.create({
    userId,
    popupVariable: variable,
    eligibleAt,
    metadata,
  });
  await maybePushPopup(created, variable);
  return created;
}

// ── Per-popup evaluators ───────────────────────────────────────────────

// Change policy: once self-booking is locked (second missed session on
// the package), stop inviting her to book. Staff rebook her instead.
// Retires any open booking popups and returns true when locked.
async function retireIfBookingLocked(userId, plan, variables) {
  if (!plan || !plan.bookingLockedAt) return false;
  await PendingPopupState.update(
    { completedAt: new Date() },
    {
      where: {
        userId,
        popupVariable: { [Op.in]: variables },
        completedAt: null,
      },
    }
  );
  return true;
}

async function evalBookInitialConsultation(user, plans) {
  // Diet/Combined plans only. Trigger: plan purchased AND no initial
  // Appointment of kind='initial' yet (or any appointment if kind not
  // wired — backward compat). Stops once initial booking exists.
  const dietOrCombined = plans.find(isDietOrCombinedPlan);
  if (!dietOrCombined) return;
  if (await retireIfBookingLocked(user.id, dietOrCombined, ["POPUP_BOOK_INITIAL_CONSULTATION"])) return;

  // Per package: a renewed package needs its own initial consultation.
  // Old rows saved before planId existed (planId null) still count, so
  // pre-release clients are never asked to book again.
  const initial = await Appointment.findOne({
    where: {
      userId: user.id,
      [Op.and]: [
        { [Op.or]: [{ kind: "initial" }, { kind: null }] },
        { [Op.or]: [{ planId: dietOrCombined.id }, { planId: null }] },
      ],
      status: { [Op.in]: ["pending", "confirmed", "In Progress", "completed"] },
    },
  });
  if (initial) {
    // Booked (from any screen) — retire the popup here on the server, so
    // it never depends on the app remembering to report it.
    await PendingPopupState.update(
      { completedAt: new Date() },
      {
        where: {
          userId: user.id,
          popupVariable: "POPUP_BOOK_INITIAL_CONSULTATION",
          completedAt: null,
        },
      }
    );
    return;
  }

  await setEligible(
    user.id,
    "POPUP_BOOK_INITIAL_CONSULTATION",
    nowPkt().toDate(),
    { userPlanId: dietOrCombined.id }
  );
}

// One pre-consultation form for every paid client (diet, workout or
// both). It shows until she has answered everything her plan needs,
// ticked the health consent and confirmed. That also catches live
// clients who signed up before the newer signup questions existed.
// Which steps are missing comes from helper/preConsultRequirements.js,
// the same source the app reads.
async function evalPreConsultationForm(user, plans) {
  // Her package decides the questions — same function the booking gate
  // and GET /requirements use (one truth).
  const { planTypeForUser } = require("./preConsultRequirements");
  const planType = await planTypeForUser(user.id);
  if (!planType) return;

  const req = await requirementsFor(user.id, planType);
  if (!req.shouldShow) {
    // Done: retire any row left eligible from before.
    await PendingPopupState.update(
      { completedAt: new Date() },
      {
        where: {
          userId: user.id,
          popupVariable: "POPUP_PRE_CONSULTATION_FORM",
          completedAt: null,
        },
      }
    );
    return;
  }

  await setEligible(
    user.id,
    "POPUP_PRE_CONSULTATION_FORM",
    nowPkt().startOf("day").toDate(),
    { planType }
  );
}

async function evalBookInitialReminder(user) {
  // Removed (Oct 2026): this reminder duplicated POPUP_BOOK_INITIAL_
  // CONSULTATION, which already asks her to book once a day from the
  // purchase day. It is no longer made eligible; close any row left
  // open from before so it stops showing.
  await PendingPopupState.update(
    { completedAt: new Date() },
    {
      where: {
        userId: user.id,
        popupVariable: "POPUP_BOOK_INITIAL_REMINDER",
        completedAt: null,
      },
    }
  );
}

async function evalEarlyCheckin(user, plans) {
  // Asked for EVERY diet plan the dietitian shares (Oct 2026): day 4 to
  // day 6 after that plan's activatedAt. One per shared plan, keyed by
  // the DietPlan id, so a new plan always gets its own check-in and an
  // answered one never comes back.
  const planIds = plans.map((p) => p.id);
  if (!planIds.length) return;
  const shared = await DietPlan.findAll({
    where: {
      userPlanId: { [Op.in]: planIds },
      activatedAt: { [Op.ne]: null },
      status: { [Op.ne]: "cancelled" },
      // Only plans a dietitian shared. The free-trial starter plan (made
      // without a dietitian) moves to the paid plan when she upgrades; it
      // must not start the paid check-ins (Oct 2026).
      dietitianId: { [Op.ne]: null },
    },
    attributes: ["id", "userPlanId", "activatedAt"],
    order: [["activatedAt", "ASC"]],
  });
  shared.forEach((dp, index) => {
    dp._isFirst = index === 0;
  });
  const inWindow = shared.filter((dp) => {
    const since = daysSince(dp.activatedAt);
    return since != null && since >= EARLY_CHECKIN_DAY_LOW && since <= EARLY_CHECKIN_DAY_HIGH;
  });
  if (!inWindow.length) {
    // Window over and she never answered: close it so it doesn't keep
    // showing on later days.
    await PendingPopupState.update(
      { completedAt: new Date() },
      { where: { userId: user.id, popupVariable: "POPUP_EARLY_CHECKIN", completedAt: null } }
    );
    return;
  }
  for (const dp of inWindow) {
    await setEligible(user.id, "POPUP_EARLY_CHECKIN", nowPkt().toDate(), {
      userPlanId: dp.userPlanId,
      dietPlanId: dp.id,
      cycle: `dp${dp.id}`,
      firstPlan: dp._isFirst,
      // Last day to answer: the app's pop-up manager moves it up.
      lastDay: daysSince(dp.activatedAt) >= EARLY_CHECKIN_DAY_HIGH,
    });
  }
}

async function evalDay7Review(user, plans) {
  // Paid plans only: never counted from the free trial (Oct 2026).
  const plan = plans.find((p) => p.firstPlanDeliveredAt && !p.isTrial);
  if (!plan) return;

  // firstPlanDeliveredAt/latestPlanDeliveredAt get stamped by
  // stampPlanDeliveryAnchors from two different places: the legacy
  // admin-panel PDF upload (controllers/Admin/AdminController.js), and
  // — the current, primary path — services/dietPlanService.js
  // activateDietPlan(), which runs when the dietitian shares an
  // AI-generated plan with the user. Either one moves the anchor, so
  // the anchor alone doesn't prove real work landed with the user.
  //
  // Gating on Appointment.status === "completed" (an earlier version
  // of this check) turned out to be the wrong proxy: that flag depends
  // on the dietitian pressing Start and the session later being closed
  // out (manually or by the auto-end cron), a flow that's had several
  // separate bugs this app cycle and can easily never fire even for a
  // client who legitimately has an active plan. What the review is
  // actually asking about is the PLAN, not the appointment — so the
  // real signal is "has an AI-generated DietPlan actually been shared
  // with this user" (DietPlan.status flipped to 'active', i.e.
  // activatedAt is set) for the UserPlan this review would be about.
  const hasSharedAiPlan = await DietPlan.findOne({
    // A plan that was shared and then cancelled doesn't count.
    where: {
      userPlanId: plan.id,
      activatedAt: { [Op.ne]: null },
      status: { [Op.ne]: "cancelled" },
    },
  });
  if (!hasSharedAiPlan) return;

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
  // Guardrail: trial-tier UserPlans (see models/UserPlan.js isTrial) are
  // free system placeholders, not a paid subscription cycle — they
  // shouldn't get the "submit your Day 15 progress" nudge that assumes
  // a paying, renewing customer.
  const plan = plans.find((p) => p.firstPlanDeliveredAt && !p.isTrial);
  if (!plan) return;
  const since = daysSince(plan.firstPlanDeliveredAt);
  if (since == null || since < DAY15_OFFSET) return;

  const existing = await ProgressSubmission.findOne({
    where: { userPlanId: plan.id, cycle: 15 },
  });
  if (existing) return;

  // planType drives which section the client shows (diet questions vs.
  // strength/stamina notes vs. both) — without it the sheet defaulted to
  // 'diet' for everyone, so a workout-only user never saw the section
  // that actually applies to them.
  await setEligible(
    user.id,
    "POPUP_DAY15_PROGRESS",
    nowPkt().toDate(),
    { userPlanId: plan.id, cycle: 15, planType: (plan.Plan && plan.Plan.planType) || "diet" }
  );
  await retireOlderReviews(user.id, "POPUP_DAY15_PROGRESS", ["POPUP_DAY7_REVIEW"]);
}

async function evalBookFollowup(user, plans) {
  // Guardrail: see evalDay15Progress — a trial plan's Day 15 progress
  // never fires, so this (gated on a Day 15 ProgressSubmission existing)
  // would already never trigger for one either. Excluded explicitly too
  // so that stays true even if the evaluator order above ever changes.
  const plan = plans.find((p) => p.firstPlanDeliveredAt && !p.isTrial);
  if (!plan) return;
  if (await retireIfBookingLocked(user.id, plan, ["POPUP_BOOK_FOLLOWUP_CONSULTATION"])) return;

  const day15 = await ProgressSubmission.findOne({
    where: { userPlanId: plan.id, cycle: 15 },
  });
  if (!day15) return;

  // Per package: a follow-up from an earlier package doesn't count.
  const followup = await Appointment.findOne({
    where: {
      userId: user.id,
      kind: "followup",
      [Op.or]: [{ planId: plan.id }, { planId: null }],
      status: { [Op.in]: ["pending", "confirmed", "In Progress", "completed"] },
    },
  });
  if (followup) {
    // Booked — retire the popup here on the server. Before this, the only
    // retirement was the app reporting it from BookConsultationSheet, but
    // the "plan ending soon" / "plan ended" banners book with a different
    // popup name the server rejects, so a client who booked from there
    // kept seeing "Book your follow-up" forever, in a loop.
    await PendingPopupState.update(
      { completedAt: new Date() },
      {
        where: {
          userId: user.id,
          popupVariable: "POPUP_BOOK_FOLLOWUP_CONSULTATION",
          completedAt: null,
        },
      }
    );
    return;
  }

  await setEligible(
    user.id,
    "POPUP_BOOK_FOLLOWUP_CONSULTATION",
    nowPkt().toDate(),
    { userPlanId: plan.id }
  );
}

async function evalDay30Progress(user, plans) {
  // Guardrail: see evalDay15Progress.
  const plan = plans.find((p) => p.firstPlanDeliveredAt && !p.isTrial);
  if (!plan) return;
  const since = daysSince(plan.firstPlanDeliveredAt);
  // Day 30 counts from plan delivery (~2 days after purchase), so on a
  // 30-day package it would land after expiry and never show. Also open
  // it in the package's last RENEW_WINDOW_DAYS days.
  const left = daysLeft(plan.expireDate);
  const nearEnd = left != null && left <= RENEW_WINDOW_DAYS;
  if ((since == null || since < DAY30_OFFSET) && !nearEnd) return;

  const existing = await ProgressSubmission.findOne({
    where: { userPlanId: plan.id, cycle: 30 },
  });
  if (existing) return;

  await setEligible(
    user.id,
    "POPUP_DAY30_PROGRESS",
    nowPkt().toDate(),
    { userPlanId: plan.id, cycle: 30, planType: (plan.Plan && plan.Plan.planType) || "diet" }
  );
  await retireOlderReviews(user.id, "POPUP_DAY30_PROGRESS", [
    "POPUP_DAY7_REVIEW",
    "POPUP_DAY15_PROGRESS",
  ]);
}

// Oct 2026: Day 7 / 15 / 30 used to pile up for a client who stopped
// opening the app. When a newer review is due, close the older open ones
// that were queued before it (a Day 7 for a plan shared later stays).
// Only the pop-up is closed: the follow-up unlock and the Day 7 alerts
// read the real submissions, not these rows.
async function retireOlderReviews(userId, newerVariable, olderVariables) {
  try {
    const newer = await PendingPopupState.findOne({
      where: { userId, popupVariable: newerVariable, completedAt: null },
      order: [["createdAt", "DESC"]],
    });
    if (!newer) return;
    await PendingPopupState.update(
      { completedAt: new Date() },
      {
        where: {
          userId,
          popupVariable: { [Op.in]: olderVariables },
          completedAt: null,
          createdAt: { [Op.lt]: newer.createdAt },
        },
      }
    );
  } catch (e) {
    console.error("[popupEligibility] retireOlderReviews failed:", e.message);
  }
}

async function evalRenewPlan(user, plans) {
  // Guardrail: "renew your plan" makes no sense for a free trial's
  // system-placeholder UserPlan — see evalDay15Progress.
  const plan = plans.find((p) => p.firstPlanDeliveredAt && !p.isTrial);
  if (!plan) return;

  // On a running free trial: no "renew" (Oct 2026). Her trial cards
  // already offer the plans; an old ended package is not news to her.
  try {
    const { TrialJourney } = require("../models");
    const { isTrialExpired } = require("./trialState");
    const tj = await TrialJourney.findOne({
      where: { userId: user.id, convertedAt: null },
      order: [["startedAt", "DESC"]],
    });
    if (tj && tj.startedAt && !isTrialExpired(tj.startedAt)) return;
  } catch (_) {
    /* trial check failed: keep the normal rule */
  }

  // Renew = the package is ending (last RENEW_WINDOW_DAYS days), whatever
  // its length. It used to wait for the Day 30 check-in, which on a
  // 30-day package came after expiry (never shown), and on longer
  // packages said "your plan is ending" at day 30.
  const left = daysLeft(plan.expireDate);
  if (left == null || left > RENEW_WINDOW_DAYS) return;

  // Already renewed: another paid package runs past this one.
  const renewed = plans.some(
    (p) =>
      p.id !== plan.id &&
      !p.isTrial &&
      p.expireDate &&
      new Date(p.expireDate).getTime() > new Date(plan.expireDate).getTime()
  );
  if (renewed) {
    await PendingPopupState.update(
      { completedAt: new Date() },
      {
        where: {
          userId: user.id,
          popupVariable: "POPUP_RENEW_PLAN",
          completedAt: null,
        },
      }
    );
    return;
  }

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

// Popups that only make sense while a paid plan is live.
const PAID_ONLY_POPUPS = [
  "POPUP_PLAN_DELAYED",
  "POPUP_DAY30_PROGRESS",
  "POPUP_DAY15_PROGRESS",
  "POPUP_DAY7_REVIEW",
  "POPUP_PRE_CONSULTATION_FORM",
  "POPUP_BOOK_FOLLOWUP_CONSULTATION",
  "POPUP_BOOK_INITIAL_CONSULTATION",
  "POPUP_BOOK_INITIAL_REMINDER",
  "POPUP_EARLY_CHECKIN",
  "POPUP_INACTIVITY_REMINDER",
  "POPUP_DAILY_LOG_REMINDER",
];

/**
 * Her paid plan ended in the last 30 days and nothing live replaced it:
 * close the paid-plan popups (book, check-ins, reviews…) and show the
 * Renew popup (at most once a week).
 */
async function evalPlanEnded(user) {
  const ended = await UserPlan.findOne({
    where: {
      userId: user.id,
      isTrial: { [Op.not]: true },
      cancelledAt: null,
      expireDate: { [Op.lt]: new Date(), [Op.gte]: moment().subtract(30, "days").toDate() },
    },
    order: [["expireDate", "DESC"]],
  });
  await PendingPopupState.update(
    { completedAt: new Date() },
    { where: { userId: user.id, popupVariable: { [Op.in]: PAID_ONLY_POPUPS }, completedAt: null } }
  );
  if (!ended) return;
  const recent = await PendingPopupState.findOne({
    where: { userId: user.id, popupVariable: "POPUP_RENEW_PLAN" },
    order: [["createdAt", "DESC"]],
  });
  const lastShown = recent && recent.lastShownAt;
  if (lastShown && daysSince(lastShown) < RENEW_PLAN_REFIRE_DAYS) {
    const nextEligible = moment(lastShown).tz(TZ).add(RENEW_PLAN_REFIRE_DAYS, "days").toDate();
    if (recent.eligibleAt && moment(recent.eligibleAt).isBefore(nextEligible)) {
      await recent.update({ eligibleAt: nextEligible });
    }
    return;
  }
  await setEligible(user.id, "POPUP_RENEW_PLAN", nowPkt().toDate(), {
    userPlanId: ended.id,
    ended: true,
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
  // Oct 2026: WORKING hours only — Sat/Sun and her dietitian's emergency
  // days don't count (helper/planDeliveryClock.js).
  const sinceHours = await require("./planDeliveryClock").workingHoursSince(new Date(completedAt), consultation.dietitionId);
  if (!(sinceHours >= PLAN_DELAY_BREACH_HOURS)) return;
  const sinceDays = daysSince(completedAt);

  // Already delivered after this consultation? Skip. Checks both the AI
  // plan (activated DietPlan) and the legacy PDF upload.
  const aiPlan = await DietPlan.findOne({
    where: {
      userId: user.id,
      activatedAt: { [Op.gte]: completedAt },
      // Cancelled after sending = she has no plan, still owed.
      status: { [Op.ne]: "cancelled" },
    },
  });
  // Legacy PDF diet plan — disabled; only the AI plan counts now.
  // const pdf = aiPlan
  //   ? null
  //   : await PdfDietsForUserNew.findOne({
  //       where: {
  //         userPlanId: dietOrCombined.id,
  //         createdAt: { [Op.gte]: completedAt },
  //       },
  //     });
  if (aiPlan) {
    // Plan arrived, so any "your plan is delayed" popup still waiting
    // for this user is now wrong. Retire it so she never sees it.
    await PendingPopupState.update(
      { completedAt: new Date() },
      {
        where: {
          userId: user.id,
          popupVariable: "POPUP_PLAN_DELAYED",
          completedAt: null,
        },
      }
    );
    return;
  }

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
    const allPlans = await UserPlan.findAll({
      where: {
        userId,
        status: true,
        expireDate: { [Op.gte]: new Date() },
      },
      include: [{ model: Plan, attributes: ["id", "title", "CategoryId", "planType"] }],
    });
    // The free trial's system UserPlan ("System — Trial Auto Diet Plan")
    // looks like a diet package by title, which would wrongly fire paid
    // popups (book consultation, pre-consultation form, reviews...) for
    // trial users now that they see the paid home. Paid popups are for
    // paid packages only.
    const paidPlans = allPlans.filter((p) => !p.isTrial);
    if (paidPlans.length === 0) {
      // Plan ended: clear the paid-plan popups, offer a renewal.
      await evalPlanEnded({ id: userId });
      return;
    }
    const plans = paidPlans;

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

  let list = Array.from(byVar.values()).filter((r) => !HIDDEN_POPUPS.has(r.popupVariable));
  // No live paid plan (ended / cancelled / paused): only popups that still
  // make sense — renew, class cancelled, medical concern, no-show.
  if (list.some((r) => PAID_ONLY_POPUPS.includes(r.popupVariable))) {
    const live = await UserPlan.count({
      where: {
        userId,
        status: true,
        isTrial: { [Op.not]: true },
        frozenAt: null,
        cancelledAt: null,
        expireDate: { [Op.gte]: new Date() },
      },
    });
    if (!live) list = list.filter((r) => !PAID_ONLY_POPUPS.includes(r.popupVariable));
  }
  // While the health form is still open, don't ask her to book the first
  // consultation yet — form first, then booking.
  if (byVar.has("POPUP_PRE_CONSULTATION_FORM")) {
    list = list.filter(
      (r) => r.popupVariable !== "POPUP_BOOK_INITIAL_CONSULTATION" && r.popupVariable !== "POPUP_BOOK_INITIAL_REMINDER"
    );
  }
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
// (status didn't flip to "In Progress"). Idempotent on PendingPopupState.
//
// Bug fix: this used to have no upper bound — a confirmed appointment
// that nobody ever started, completed, canceled, or reported stayed
// eligible forever, and setEligible refreshes eligibleAt to "now" every
// time this cron runs (once a minute), so the client saw this as
// endlessly re-eligible. Combined with POPUP_CONSULTANT_NO_SHOW being
// the 2nd-highest-priority, non-dismissible popup, that meant a single
// stale appointment (e.g. leftover test data) would interrupt the user
// with a blocking "Consultant hasn't joined" sheet on every app open,
// indefinitely, with no way out except manually reporting it.
//
// Fixed with a staleness ceiling (NO_SHOW_STALE_HOURS): appointments
// past that window stop being (re-)made eligible, and any already-open
// PendingPopupState row for one is auto-retired here so it self-heals
// without needing a manual DB fix — AND an escalation is opened so
// staff still find out about the missed session even though the user
// never tapped "Report" (previously only the user-initiated report path
// created one; a session nobody ever reports silently vanished).
async function evaluateConsultantNoShows() {
  const cutoff = nowPkt().subtract(NO_SHOW_GRACE_MINUTES, "minutes").toDate();
  const staleFloor = nowPkt().subtract(NO_SHOW_STALE_HOURS, "hours").toDate();

  // Oct 2026: the client is no longer asked "did your dietitian join?".
  // The server decides (Meet attendance sweep first, this 24h fallback
  // second) and simply tells her the session was canceled, the free
  // days added, and how to rebook. So we no longer make the
  // POPUP_CONSULTANT_NO_SHOW prompt eligible, and retire any old rows.
  void cutoff;
  try {
    await PendingPopupState.update(
      { completedAt: new Date() },
      {
        where: {
          popupVariable: "POPUP_CONSULTANT_NO_SHOW",
          completedAt: null,
        },
      }
    );
  } catch (e) {
    console.error("[popupEligibility] retire no-show prompts:", e);
  }

  // Now-stale: still confirmed + unreported, but past the staleness
  // ceiling. Auto-retire any open popup state and escalate once.
  const staleRows = await Appointment.findAll({
    where: {
      status: "confirmed",
      date: { [Op.lt]: staleFloor },
      noShowReportedAt: null,
      paymentHoldAt: null,
    },
  });
  for (const a of staleRows) {
    try {
      // A PendingPopupState row for this appointment may never have
      // been created — e.g. it went stale before this auto-resolution
      // logic shipped, or the "newly eligible" pass never got to run
      // for it. Resolution must NOT depend on that row existing: it's
      // purely a "retire this popup so the client stops being
      // prompted" side effect, done best-effort when there is one to
      // retire, never a gate on the actual auto-cancel/escalate below.
      const existing = await PendingPopupState.findOne({
        where: {
          userId: a.userId,
          popupVariable: "POPUP_CONSULTANT_NO_SHOW",
          completedAt: null,
        },
        order: [["createdAt", "DESC"]],
      });
      if (existing) {
        await existing.update({ completedAt: new Date() });
      }

      // If the Meet attendance check already found hard evidence the
      // dietitian DID attend, don't treat "nobody clicked anything in
      // the app for 24h" as proof of a no-show — that would wrongly
      // cancel a session that genuinely happened just because the
      // status field never got updated. (checkMeetAttendance's own
      // fast path already resolves the true no-show case well before
      // this point is ever reached.)
      if (a.meetDietitianAttended === true) {
        continue;
      }

      await createEscalation({
        userId: a.userId,
        dietitianId: a.dietitionId || null,
        trigger: "CONSULT_NO_SHOW",
        severity: "medium",
        payload: {
          appointmentId: a.id,
          scheduledDate: a.date,
          autoRetired: true,
        },
      });

      // Nobody reported it and 24 hours passed anyway — resolve it
      // for her instead of leaving the booking stuck at "confirmed"
      // forever with no real answer on her screen. Cancels it and
      // notifies her that rebooking is free. This flips status away
      // from "confirmed", so this same row will not be re-matched by
      // the staleRows query on the next tick (no separate dedup flag
      // needed).
      await resolveDietitianNoShow(a);
    } catch (e) {
      console.error("[popupEligibility] no-show stale retire:", e);
    }
  }
}

// Auto-expires a "pending" appointment — the client booked it, but the
// dietitian never confirmed it AT ALL — once its scheduled time has
// passed. No grace period here (unlike the no-show case): a pending
// booking whose slot time is already in the past has nothing left to
// wait for, since nothing was ever confirmed in order to check whether
// it happened. Runs every minute, same cadence as the no-show check.
async function evaluateUnconfirmedBookings() {
  const now = nowPkt().toDate();

  const rows = await Appointment.findAll({
    where: {
      status: "pending",
      date: { [Op.lt]: now },
      expiredAt: null,
    },
  });

  for (const a of rows) {
    try {
      await createEscalation({
        userId: a.userId,
        dietitianId: a.dietitionId || null,
        trigger: "CONSULT_UNCONFIRMED",
        severity: "low",
        payload: {
          appointmentId: a.id,
          scheduledDate: a.date,
          autoExpired: true,
        },
      });
      await resolveUnconfirmedExpiry(a);
    } catch (e) {
      console.error("[popupEligibility] unconfirmed-booking expiry:", e);
    }
  }
}

module.exports = {
  setEligible,
  evaluateForUser,
  evaluateAllActiveUsers,
  evaluateConsultantNoShows,
  evaluateUnconfirmedBookings,
  listForUser,
  PRIORITY,
  NO_SHOW_GRACE_MINUTES,
  NO_SHOW_STALE_HOURS,
};
