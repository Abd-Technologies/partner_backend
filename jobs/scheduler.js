// jobs/scheduler.js — every scheduled job of the app backend (Nov 2026).
//
// Moved here from app.js unchanged, except that `cron` is
// helper/jobRunner.js lockedCron(): each job takes a database lock (runs in
// one process at a time), records a heartbeat (GET /admin/health) and logs
// failures. start({ mode }) decides which jobs run in this process:
//   all    (default) everything — exactly as before
//   web    only the jobs that push live socket updates (app.js, RUN_JOBS=web)
//   worker everything else (worker.js)
//   none   nothing

const { sendUpcomingSlotNotificationsPerUser } = require('../helper/crownjobfunction');
const { runFreeTrialExpiryBatch } = require('../helper/freeTrialExpiry');
const {
  sendDownloadedUserNudges,
  sendTrialChurnedNudges,
  sendTrialJourneyNudges,
  sendTrialJourneyChurnedNudges,
  sendLifecycleNudges,
  sendWeeklyCheckinReminders,
  sendLunaDailyNudges,
} = require('../helper/notifications');




const {
  User,
  UserPlan,
  Time,
  Slot,
  Plan,
  DietTime,
  Diet,
} = require("../models");
const sendNotification = require("../helper/notification");
const moment = require("moment");
const { autoEndExpiredSessions, GRACE_MINUTES } = require("../helper/autoEndSessions");
const { autoEndExpiredAppointments, GRACE_MINUTES: APPT_GRACE_MINUTES } = require("../helper/autoEndExpiredAppointments");
const { checkMeetAttendance } = require("../helper/checkMeetAttendance");
const { autoUnfreezeExpiredPlans } = require("../helper/autoUnfreezeExpiredPlans");
const { sendPlanDeliveryReminders } = require("../helper/planDeliveryReminders");
const { sendTrialClassReminders } = require("../helper/trialClasses");
const { sendTrialOfferReminders, sendTrialLastDayPushes } = require("../helper/trialOffer");
const { sendPostpartumReadyReminders, sendDueDateCheckIns } = require("../helper/lifeStage");
const { autoExpireUserPlans } = require("../helper/autoExpireUserPlans");
const { sendMissedSessionRecovery } = require("../helper/missedSessionRecovery");
const popupEligibility = require("../helper/popupEligibility");

function start({ mode = "all" } = {}) {
const cron = require("../helper/jobRunner").lockedCron(require("node-cron"), mode);

// All workout-flow crons run on PKT — slot wall-clocks are stored as
// AM/PM PKT, so anchoring the schedules to PKT is the only way the
// daily reset, the auto-end grace window, and the FCM cadence line up
// with what users actually see. Without this, the cron runs at the
// host's local time (UTC on most VPS deployments) which is +5h off.
const CRON_TZ = "Asia/Karachi";

// Dietitian emergency day (Oct 2026): every minute, apply requests whose
// 2-minute undo window has passed. See helper/emergencyDay.js.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const n = await require("../helper/emergencyDay").applyDue();
      if (n) console.log(`[emergency-day] applied ${n}`);
    } catch (error) {
      console.error("Error in emergency-day job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Consultation rating reminder (Nov 2026): one push if she hasn't rated
// 6 h after her session. helper/consultReviewAsk.js.
cron.schedule(
  "*/30 * * * *",
  async () => {
    try {
      const n = await require("../helper/consultReviewAsk").remindReviews();
      if (n) console.log(`[consult-review] reminded ${n}`);
    } catch (error) {
      console.error("Error in consult-review reminder job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Dietitian no-show while the client waits (Oct 2026): every minute.
// 5 min late → "Your client is waiting" + admin alert; not started 10 min after the start time → cancelled as a dietitian
// no-show (+3 days, client told). See helper/dietitianLateCheck.js.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const r = await require("../helper/dietitianLateCheck").runDietitianLateCheck();
      if (r.alerted || r.cancelled) console.log(`[dietitian-late] alerted ${r.alerted}, cancelled ${r.cancelled}`);
    } catch (error) {
      console.error("Error in dietitian-late job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Notification cron — every 3 minutes, PKT-anchored.
cron.schedule(
  "*/3 * * * *",
  async () => {
    try {
      await sendUpcomingSlotNotificationsPerUser();
    } catch (error) {
      console.error("Error in 3-minute job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Missed-session recovery. Every 10 min: one nudge per class day, 30 min
// after HER last class ends (same evening), or 9 AM–noon next morning if
// that fell in quiet hours. See helper/missedSessionRecovery.js. Preference-gated by
// NotificationPreference.missedRecovery in helper/notification.js.
cron.schedule(
  "*/10 * * * *",
  async () => {
    try {
      const sent = await sendMissedSessionRecovery();
      if (sent > 0) {
        console.log(`[missed-recovery] Sent ${sent} reminder(s)`);
      }
    } catch (error) {
      console.error("Error in missed-session-recovery job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Free trial class reminders: 15 min before her picked class and "live
// now" at start if she hasn't joined. Max 2 a day, none once she has
// joined a class today. See helper/trialClasses.js.
cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      const n = await sendTrialClassReminders();
      if (n) console.log(`[trial-class-reminder] sent ${n}`);
    } catch (error) {
      console.error("Error in trial-class-reminders job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// End-of-trial offer: one reminder when about a day is left. Hourly.
cron.schedule(
  "41 * * * *",
  async () => {
    try {
      await sendTrialOfferReminders();
    } catch (error) {
      console.error("Error in trial-offer-reminders job:", error);
    }
    // Trial moments (Nov 2026, helper/trialMoments.js): Day 2 missed
    // class, Day 3, Day 4, last day, trial ended, and the offer 6 h
    // before it ends. Replaces the old last-day push (sendTrialLastDayPushes).
    try {
      const n = await require("../helper/trialMoments").runTrialPushes();
      if (n) console.log(`[trial-moments] sent ${n}`);
    } catch (error) {
      console.error("Error in trial-moments job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Trial starter plans the AI couldn't make in time (or a restart lost):
// try again quietly every 5 minutes (Oct 2026).
cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      const { retryPendingTrialPlans } = require("../controllers/FrontSite/trialDietPlanController");
      const n = await retryPendingTrialPlans();
      if (n) console.log(`[trial-plan] retrying ${n} plan(s)`);
    } catch (error) {
      console.error("Error in trial-plan retry job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// New mothers: one "you're ready to join" push the day her waiting
// time after birth ends. Daily at 10:00 PKT.
cron.schedule(
  "0 10 * * *",
  async () => {
    try {
      await sendPostpartumReadyReminders();
      await sendDueDateCheckIns();
    } catch (error) {
      console.error("Error in postpartum-ready job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Plan delivery SLA reminders to the dietitian (24h, 36h after the
// consultation) plus an admin heads-up at 36h. Hourly; the 48h breach is
// handled by the popup eligibility cron (evalPlanDelayed).
cron.schedule(
  "23 * * * *",
  async () => {
    try {
      await sendPlanDeliveryReminders();
    } catch (error) {
      console.error("Error in plan-delivery-reminders job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Auto-end "In Progress" slots whose end time + grace has passed.
// Runs every minute (PKT) so the worst-case lag past the grace window
// is ~60s. Trainer-driven manual end is still the intended path — this
// is the safety net that keeps quality auditing meaningful when a
// trainer forgets to flip the status themselves.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const ended = await autoEndExpiredSessions();
      if (ended.length > 0) {
        console.log(
          `[auto-end] Flipped ${ended.length} stale slot(s) to "Completed" (grace ${GRACE_MINUTES}m): ${ended.join(", ")}`
        );
      }
    } catch (error) {
      console.error("Error in auto-end-sessions job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Trainer safety nets: "starts in 10 min, tap Start" + "your class is
// waiting" at +3 (every minute), and a 07:00 PKT check for classes whose
// trainer has no Zoom room. See helper/trainerClassReminders.js.
const { sendTrainerStartReminders, morningRoomCheck } = require("../helper/trainerClassReminders");
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const n = await sendTrainerStartReminders();
      if (n) console.log(`[trainer-reminder] sent ${n}`);
    } catch (error) {
      console.error("[trainer-reminder]", error.message);
    }
  },
  { timezone: CRON_TZ }
);
cron.schedule(
  "0 7 * * *",
  async () => {
    try {
      await morningRoomCheck();
    } catch (error) {
      console.error("[room-check]", error.message);
    }
  },
  { timezone: CRON_TZ }
);

// Quiet hours (Oct 2026): pushes held during her quiet hours go out when
// they end. Checked every 5 minutes.
cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      const n = await require("../helper/notification").releaseHeldPushes();
      if (n) console.log(`[quiet-hours] sent ${n} held push(es)`);
    } catch (error) {
      console.error("Error in quiet-hours release job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Auto-cancel a class the trainer hasn't started 10 min after its time,
// with an apology push + in-app popup pointing to the next class.
const { autoCancelLateClasses, retireOldClassCancelledPopups, LATE_START_MINUTES } = require("../helper/autoCancelLateClasses");
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const ids = await autoCancelLateClasses();
      if (ids.length) console.log(`[auto-cancel-class] cancelled ${ids.length} class(es) not started ${LATE_START_MINUTES}m after start: ${ids.join(", ")}`);
      await retireOldClassCancelledPopups();
      await require("../helper/consultationCancelledPopup").retireOldConsultationCancelledPopups();
    } catch (error) {
      console.error("Error in auto-cancel-class job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// "Finish your health form" push (day 1 / 3 / 7 while it's still open),
// for paid clients who don't open the app. helper/preConsultFormReminders.js
const { sendPreConsultFormReminders } = require("../helper/preConsultFormReminders");
cron.schedule(
  "13 11 * * *",
  async () => {
    try {
      const n = await sendPreConsultFormReminders();
      if (n) console.log(`[preconsult-reminder] sent ${n}`);
    } catch (error) {
      console.error("[preconsult-reminder]", error.message);
    }
  },
  { timezone: CRON_TZ }
);

// Monthly "check your PCOS signs" push for paid women who track a
// condition (only when due, max once a month). helper/healthScreeningActions.js
cron.schedule(
  "31 11 * * *",
  async () => {
    try {
      const n = await require("../helper/healthScreeningActions").sendMonthlyReminders();
      if (n) console.log(`[screening-reminder] sent ${n}`);
    } catch (error) {
      console.error("[screening-reminder]", error.message);
    }
  },
  { timezone: CRON_TZ }
);

// AI-approved payments: admin reminders at 24 h / 40 h, pause at 48 h.
cron.schedule(
  "17 * * * *",
  async () => {
    try {
      const r = await require("../helper/paymentVerify").runChecks();
      if (r.reminded || r.held) console.log(`[payment-verify] reminded ${r.reminded}, paused ${r.held}`);
    } catch (error) {
      console.error("[payment-verify]", error.message);
    }
  },
  { timezone: CRON_TZ }
);

// Sign-up questions left unfinished: one "finish setting up" push, 7:10 PM.
cron.schedule(
  "10 19 * * *",
  async () => {
    try {
      const n = await require("../helper/onboardingReminder").sendFinishSignupReminders();
      if (n) console.log(`[finish-signup] sent ${n}`);
    } catch (error) {
      console.error("[finish-signup]", error.message);
    }
  },
  { timezone: CRON_TZ }
);

// Time zone from phone country code for users whose (old) app never sent
// one. Daily 03:20 PKT + once on start. helper/timezoneFromPhone.js
const { backfillTimezonesFromPhone } = require("../helper/timezoneFromPhone");
const runTzBackfill = async () => {
  try {
    const n = await backfillTimezonesFromPhone();
    if (n) console.log(`[tz-backfill] set time zone for ${n} user(s) from phone code`);
  } catch (error) {
    console.error("[tz-backfill]", error.message);
  }
};
cron.schedule("20 3 * * *", runTzBackfill, { timezone: CRON_TZ });
if (cron.runsNonSocket) setTimeout(runTzBackfill, 30 * 1000);

// "Consultation in 15 minutes" push to client + dietitian (once per session).
const { sendConsultationReminders } = require("../helper/consultationReminders");
cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      const n = await sendConsultationReminders();
      if (n > 0) console.log(`[consult-reminder] sent ${n} reminder(s)`);
    } catch (error) {
      console.error("Error in consultation-reminder job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Diet equivalent of the trainer auto-end. Sweeps "In Progress"
// Appointments whose SlotDiet.end + grace has passed. The endpoint that
// flips confirmed → In Progress is POST /appointment/:id/start, called
// when the dietitian taps "Start Session". If they forget to mark the
// session completed afterwards, this safety net flips it on their behalf
// with completed_by = NULL as the audit signal.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const ended = await autoEndExpiredAppointments();
      if (ended.length > 0) {
        console.log(
          `[auto-end-appt] Flipped ${ended.length} stale appointment(s) to "completed" (grace ${APPT_GRACE_MINUTES}m): ${ended.join(", ")}`
        );
      }
    } catch (error) {
      console.error("Error in auto-end-appointments job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Pulls real Google Meet attendance data for completed consultations
// that have a link on file (SlotDiet.dietitionLink), instead of relying
// on the dietitian remembering to report a no-show. See
// services/meetAttendance/ and docs on the migration for what each
// saved field means. Runs every 10 minutes rather than every minute —
// attendance data doesn't need to be instant, and this keeps API call
// volume low. Silently does nothing until a dietitian account has been
// linked via scripts/linkDietitianMeetAccount.js.
cron.schedule(
  "*/10 * * * *",
  async () => {
    try {
      const result = await checkMeetAttendance();
      if (result.checked > 0 || result.errors > 0) {
        console.log(
          `[meet-attendance] checked ${result.checked}, skipped ${result.skipped}, errors ${result.errors}`
        );
      }
    } catch (error) {
      console.error("Error in check-meet-attendance job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Auto-unfreeze for the user-button freeze flow. When frozenAt +
// freezeDays has elapsed the cron flips the plan back to active and
// sets unfrozenBy = NULL as the audit signal (mirrors completed_by on
// Appointment). Users can still unfreeze early via POST /users/plan/unfreeze.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const unfrozen = await autoUnfreezeExpiredPlans();
      if (unfrozen.length > 0) {
        console.log(
          `[auto-unfreeze] Unfroze ${unfrozen.length} plan(s): ${unfrozen.join(", ")}`
        );
      }
    } catch (error) {
      console.error("Error in auto-unfreeze-plans job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// CRM events (Nov 2026): resend queued CRM events that are due (the CRM
// was down, or a first send failed). helper/crmEvents.js, models/CrmOutbox.js.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const n = await require("../helper/crmEvents").flush();
      if (n) console.log(`[crm-events] delivered ${n}`);
    } catch (error) {
      console.error("Error in crm-events job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Subscription expiry: hourly sweep that flags UserPlan rows whose
// expireDate has passed via planStatus = 'expired'. Nothing previously
// set this server-side — the app derived "expired" itself from the
// date on every render. Does not touch the `status` boolean (that
// still gates GET /users/get_user_plans visibility) and skips frozen
// plans, whose clock is paused. See helper/autoExpireUserPlans.js for
// the full reasoning.
cron.schedule(
  "0 * * * *",
  async () => {
    try {
      const expired = await autoExpireUserPlans();
      if (expired.length > 0) {
        console.log(
          `[auto-expire-plans] Marked ${expired.length} plan(s) expired: ${expired.join(", ")}`
        );
      }
    } catch (error) {
      console.error("Error in auto-expire-plans job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Consultation-flow: per-minute consultant-no-show check.
// (Oct 2026) No client prompt any more: confirmed sessions nobody
// started are resolved by the server (Meet attendance sweep, or the
// 24h fallback inside evaluateConsultantNoShows), which cancels the
// session, adds the free days and notifies her.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      await popupEligibility.evaluateConsultantNoShows();
    } catch (error) {
      console.error("Error in consultant-no-show job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Consultation-flow: per-minute unconfirmed-booking expiry. Looks for
// "pending" appointments (client booked, dietitian never confirmed at
// all) whose scheduled time has already passed, and auto-cancels them
// right away — unlike the no-show check above, there's no grace period
// to wait out here, since nothing was ever confirmed in the first
// place. Tells the client to book a new time, and logs a
// CONSULT_UNCONFIRMED escalation so missed booking requests are
// trackable separately from no-shows.
cron.schedule(
  "* * * * *",
  async () => {
    try {
      await popupEligibility.evaluateUnconfirmedBookings();
    } catch (error) {
      console.error("Error in unconfirmed-booking expiry job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Hourly mass eligibility refresh. Walks every user with an active plan
// and recomputes which popups should fire. Idempotent — eligibility rows
// are deduped by (userId, popupVariable, completedAt). The hourly cadence
// is the safety net; the dashboard endpoint also evaluates per-user on
// every fetch so a freshly-purchased user doesn't wait up to an hour.
cron.schedule(
  "0 * * * *",
  async () => {
    try {
      await popupEligibility.evaluateAllActiveUsers();
    } catch (error) {
      console.error("Error in popup-eligibility hourly job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Class diary: count joined / attended / minutes for today's classes
// before the 00:01 reset (helper/classDiary.js). Analytics only.
cron.schedule(
  "55 23 * * *",
  async () => {
    try {
      const n = await require("../helper/classDiary").countDay();
      console.log(`[class-diary] counted ${n} class(es)`);
    } catch (e) {
      console.error("[class-diary] count failed:", e.message);
    }
  },
  { timezone: CRON_TZ }
);

// Daily reset at 00:01 PKT. Wipes all slots back to "Upcoming Class"
// so next-day users see a clean schedule. Calorie counters reset too.
cron.schedule(
  "1 0 * * *",
  async () => {
    console.log("Running daily reset at 00:01 PKT...");
    try {
      await User.update(
        { caloriesCounter: 0 },
      { where: {} } // update all users
    );

    await Slot.update(
      { status: "Upcoming Class" },
      { where: {} } // update all slots
    );

    console.log("✅ All user calories counters reset successfully.");
    } catch (error) {
      console.error("❌ Error resetting calories counters:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Free trial expiry — nightly at 02:00 PKT.
// Finds expired Free Trial UserPlans where user.status=true, flips status=false
// (so trialChurned.js picks them up), destroys UserPlan + FreeTrailUsers + slots.
// Without this, users who never reopen the app after expiry are invisible to churn
// notifications — userHome() only runs expiry on-demand when the app is opened.
cron.schedule(
  '0 2 * * *',
  async () => {
    try {
      await runFreeTrialExpiryBatch();
    } catch (error) {
      console.error('[cron] free-trial-expiry failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

// Downloaded-user nudge at 09:00 PKT daily.
// Targets users who signed up but never started a trial (usedFreeTrial=false).
// Day-based message sequence: day 2-6 / 7-13 / 14-20 / 21-30 — stops after day 30.
// 7-day cooldown per user so each bucket fires once.
cron.schedule(
  '0 9 * * *',
  async () => {
    try {
      await sendDownloadedUserNudges();
    } catch (error) {
      console.error('[cron] downloaded-user nudge failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

// Trial-churned nudge at 09:05 PKT daily.
// Targets users who used their free trial but never bought a paid plan.
// 5-minute offset ensures both segments log cleanly without overlapping I/O.
cron.schedule(
  '5 9 * * *',
  async () => {
    try {
      await sendTrialChurnedNudges();
    } catch (error) {
      console.error('[cron] trial-churned nudge failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

// Lifecycle nudge at 10:00 PKT daily.
// Sends to churned PAID users segmented by plan state:
//   midPackageChurn  — plan still active but account deactivated
//   postPackageEarly — plan expired 1–14 days ago
//   postPackageMid   — plan expired 15–45 days ago
//   postPackageLate  — plan expired 46–90 days ago
// Messages are personalised with the user's cycle phase where available.
cron.schedule(
  '0 10 * * *',
  async () => {
    try {
      await sendLifecycleNudges();
    } catch (error) {
      console.error('[cron] lifecycle nudge failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

// TrialJourney nudge at 09:10 PKT daily.
// Targets users who started the 3-day TrialJourney flow (trialController.js)
// but are stuck at a state transition (haven't booked the next day or converted).
// State-machine based: each segment fires only when the journey has been
// idle long enough (minStaleDays) and respects a per-type cooldown.
// 5-minute offset from trialChurned (09:05) to keep DB I/O clean.
cron.schedule(
  '10 9 * * *',
  async () => {
    try {
      await sendTrialJourneyNudges();
    } catch (error) {
      console.error('[cron] trial-journey nudge failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

// Luna daily (Nov 2026): 8 PM in each woman's own time zone, paid + live
// trial, "log today's insights". Every 5 min; once a day per woman.
cron.schedule(
  "*/5 * * * *",
  async () => {
    try {
      await sendLunaDailyNudges();
    } catch (error) {
      console.error('[cron] luna daily failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

// TrialJourneyChurned nudge at 09:15 PKT daily.
// Targets users who completed all 3 trial days (day3AttendedAt set) but never
// converted to a paid plan. Highest-intent segment — attended 3 classes, didn't buy.
// trialJourney.js covers them for the first 14 days (trialJourneyConvert segment).
// This channel picks up from day 15 onward with a 4-bucket re-engagement sequence.
// 5-minute offset from trialJourney (09:10) to keep DB I/O clean.
cron.schedule(
  '15 9 * * *',
  async () => {
    try {
      await sendTrialJourneyChurnedNudges();
    } catch (error) {
      console.error('[cron] trial-journey-churned nudge failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

// Weekly check-in reminder — Sunday 19:00 PKT.
// Nudges active users (status=true) who haven't submitted a WeeklyCheckin
// this ISO week yet. Gated by NotificationPreference.weeklyCheckin (default on).
// Phase-aware body for cycle-tracked users.
// 6-day recentlySent dedup prevents double-fire if cron runs twice.
cron.schedule(
  '0 19 * * 0',
  async () => {
    try {
      await sendWeeklyCheckinReminders();
    } catch (error) {
      console.error('[cron] weekly-checkin failed:', error);
    }
  },
  { timezone: CRON_TZ }
);

console.log(`⏰ [jobs] scheduler started (mode: ${mode})`);
}

module.exports = { start };
