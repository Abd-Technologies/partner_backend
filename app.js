require("dotenv").config();
const { init,getIO } = require("./socket");
const express = require("express");
const app = express();
// Behind one proxy (nginx): req.ip = the real client IP (rate limits).
if (!app.get("trust proxy")) app.set("trust proxy", 1);

const bodyParser = require("body-parser");
const cors = require("cors");
const http = require("http");
const server = http.createServer(app); // Create HTTP server

const io = init(server); 


io.on("connection", (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);  
});

//const serverPort=3001;
//server.listen(serverPort, () => {
//  console.log("🚀 Server running on http://localhost:3000");
//});




const db = require("./models");
const error = require("./middlewares/error");
const userRoute = require("./routes/FrontSite/user");
const AdminRoute = require("./routes/Admin/admin");
const contriesRoute = require('./routes/FrontSite/coutrieRotes')
const priceDurationRoutes = require('./routes/FrontSite/durationpriceroutes')
const priceingRoutes = require('./routes/FrontSite/priceingRoutes')
const appoinmentRoutes=require('./routes/FrontSite/appointmentRoutes')
const dietRoutes = require('./routes/FrontSite/dietRoutes')
const appointmentRoutes = require('./routes/FrontSite/appointmentRoutes')
const attendanceRoutes=require('./routes/FrontSite/attendanceRoutes')
const postsRoutes=require('./routes/FrontSite/postsRoutes.js')
const directPayRoutes=require('./routes/FrontSite/directPay.js')
const waterRoutes = require('./routes/FrontSite/water')
const dashboardRoutes = require('./routes/FrontSite/dashboard')
const progressRoutes = require('./routes/FrontSite/progress')
const preConsultationRoutes = require('./routes/FrontSite/preConsultation')
const preConsultationAdminRoutes = require('./routes/Admin/preConsultation')
const popupStateRoutes = require('./routes/FrontSite/popupState')
const mealLogRoutes = require('./routes/FrontSite/mealLog')
const day7ReviewRoutes = require('./routes/FrontSite/day7Review')
const day7ReviewAdminRoutes = require('./routes/Admin/day7Review')
const progressSubmissionRoutes = require('./routes/FrontSite/progressSubmission')
const progressSubmissionAdminRoutes = require('./routes/Admin/progressSubmission')
const consultationBookingRoutes = require('./routes/FrontSite/consultationBooking')
const escalationRoutes = require('./routes/FrontSite/escalation')
const appIssueRoutes = require('./routes/FrontSite/appIssue')
const internalRoutes = require('./routes/internal')
const escalationAdminRoutes = require('./routes/Admin/escalation')
const supportTicketAdminRoutes = require('./routes/Admin/supportTickets')
const metricsAdminRoutes = require('./routes/Admin/metrics')
const trialRoutes = require('./routes/FrontSite/trial')
const dietPlanAdminRoutes = require('./routes/Admin/dietPlan')
const magicLinkRoutes = require('./routes/FrontSite/magicLink')
const dietPlanUserRoutes = require('./routes/FrontSite/dietPlan')



const { Server } = require("socket.io"); // FIX: Import Server from socket.io

const { sendUpcomingSlotNotificationsPerUser } = require('./helper/crownjobfunction');
const { runFreeTrialExpiryBatch } = require('./helper/freeTrialExpiry');
const {
  sendDownloadedUserNudges,
  sendTrialChurnedNudges,
  sendTrialJourneyNudges,
  sendTrialJourneyChurnedNudges,
  sendLifecycleNudges,
  sendWeeklyCheckinReminders,
} = require('./helper/notifications');




const {
  User,
  UserPlan,
  Time,
  Slot,
  Plan,
  DietTime,
  Diet,
} = require("./models");
const cron = require("node-cron");
const sendNotification = require("./helper/notification");
const moment = require("moment");
const { autoEndExpiredSessions, GRACE_MINUTES } = require("./helper/autoEndSessions");
const { autoEndExpiredAppointments, GRACE_MINUTES: APPT_GRACE_MINUTES } = require("./helper/autoEndExpiredAppointments");
const { checkMeetAttendance } = require("./helper/checkMeetAttendance");
const { autoUnfreezeExpiredPlans } = require("./helper/autoUnfreezeExpiredPlans");
const { sendPlanDeliveryReminders } = require("./helper/planDeliveryReminders");
const { sendTrialClassReminders } = require("./helper/trialClasses");
const { sendTrialOfferReminders, sendTrialLastDayPushes } = require("./helper/trialOffer");
const { sendPostpartumReadyReminders, sendDueDateCheckIns } = require("./helper/lifeStage");
const { autoExpireUserPlans } = require("./helper/autoExpireUserPlans");
const { sendMissedSessionRecovery } = require("./helper/missedSessionRecovery");
const popupEligibility = require("./helper/popupEligibility");


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
      const n = await require("./helper/emergencyDay").applyDue();
      if (n) console.log(`[emergency-day] applied ${n}`);
    } catch (error) {
      console.error("Error in emergency-day job:", error);
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
      const r = await require("./helper/dietitianLateCheck").runDietitianLateCheck();
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
      const n = await require("./helper/trialMoments").runTrialPushes();
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
      const { retryPendingTrialPlans } = require("./controllers/FrontSite/trialDietPlanController");
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
const { sendTrainerStartReminders, morningRoomCheck } = require("./helper/trainerClassReminders");
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
      const n = await require("./helper/notification").releaseHeldPushes();
      if (n) console.log(`[quiet-hours] sent ${n} held push(es)`);
    } catch (error) {
      console.error("Error in quiet-hours release job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// Auto-cancel a class the trainer hasn't started 10 min after its time,
// with an apology push + in-app popup pointing to the next class.
const { autoCancelLateClasses, retireOldClassCancelledPopups, LATE_START_MINUTES } = require("./helper/autoCancelLateClasses");
cron.schedule(
  "* * * * *",
  async () => {
    try {
      const ids = await autoCancelLateClasses();
      if (ids.length) console.log(`[auto-cancel-class] cancelled ${ids.length} class(es) not started ${LATE_START_MINUTES}m after start: ${ids.join(", ")}`);
      await retireOldClassCancelledPopups();
      await require("./helper/consultationCancelledPopup").retireOldConsultationCancelledPopups();
    } catch (error) {
      console.error("Error in auto-cancel-class job:", error);
    }
  },
  { timezone: CRON_TZ }
);

// "Finish your health form" push (day 1 / 3 / 7 while it's still open),
// for paid clients who don't open the app. helper/preConsultFormReminders.js
const { sendPreConsultFormReminders } = require("./helper/preConsultFormReminders");
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
      const n = await require("./helper/healthScreeningActions").sendMonthlyReminders();
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
      const r = await require("./helper/paymentVerify").runChecks();
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
      const n = await require("./helper/onboardingReminder").sendFinishSignupReminders();
      if (n) console.log(`[finish-signup] sent ${n}`);
    } catch (error) {
      console.error("[finish-signup]", error.message);
    }
  },
  { timezone: CRON_TZ }
);

// Time zone from phone country code for users whose (old) app never sent
// one. Daily 03:20 PKT + once on start. helper/timezoneFromPhone.js
const { backfillTimezonesFromPhone } = require("./helper/timezoneFromPhone");
const runTzBackfill = async () => {
  try {
    const n = await backfillTimezonesFromPhone();
    if (n) console.log(`[tz-backfill] set time zone for ${n} user(s) from phone code`);
  } catch (error) {
    console.error("[tz-backfill]", error.message);
  }
};
cron.schedule("20 3 * * *", runTzBackfill, { timezone: CRON_TZ });
setTimeout(runTzBackfill, 30 * 1000);

// "Consultation in 15 minutes" push to client + dietitian (once per session).
const { sendConsultationReminders } = require("./helper/consultationReminders");
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
      const n = await require("./helper/classDiary").countDay();
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

app.use(cors());
app.use(express.json());

//for form data and multipart data
app.use(bodyParser.urlencoded({ extended: true }));

// app.use(upload.array());

app.use("/users", userRoute);
app.use("/admin", AdminRoute);
// Magic payment links — registers /admin/magic-links (rep-only) and
// /magic-links/:token (+/redeem) public endpoints. Routes file mounts
// at the root so it can expose both /admin/* and /magic-links/* paths.
app.use("/", magicLinkRoutes);
app.use("/country", contriesRoute);
app.use('/duration/create', priceDurationRoutes);
app.use('/api/priceingRoutes', priceingRoutes);
app.use('/appointment', appointmentRoutes);
// Dietitian "Emergency: cancel my day" (Oct 2026).
app.use('/emergency-day', require('./routes/FrontSite/emergencyDayRoutes'));
app.use('/dietTimes', dietRoutes);
app.use("/attendance", attendanceRoutes);
app.use("/posts", postsRoutes);
app.use("/pay", directPayRoutes);
app.use('/users', waterRoutes);
app.use('/users/home', dashboardRoutes);
app.use('/users/progress', progressRoutes);
app.use('/users/pre-consultation', preConsultationRoutes);
app.use('/admin/pre-consultation', preConsultationAdminRoutes);
app.use('/users/popup', popupStateRoutes);
app.use('/users/meal-logs', mealLogRoutes);
app.use('/users/day7-review', day7ReviewRoutes);
app.use('/admin/day7-reviews', day7ReviewAdminRoutes);
app.use('/users/progress', progressSubmissionRoutes);
app.use('/admin/users', progressSubmissionAdminRoutes);
app.use('/users', consultationBookingRoutes);
app.use('/users/escalations', escalationRoutes);
app.use('/users/app-issue', appIssueRoutes);
app.use('/internal', internalRoutes);
app.use('/admin/escalations', escalationAdminRoutes);
app.use('/admin/support-tickets', supportTicketAdminRoutes);
app.use('/admin/metrics', metricsAdminRoutes);
app.use('/trial', trialRoutes);
app.use('/admin/diet-plan', dietPlanAdminRoutes);
app.use('/users/diet-plan', dietPlanUserRoutes);

// Error middleware : To show any error if promise fails
app.use(error);
// To make the folder Public
// Protected private files (Oct 2026, helper/privateFiles.js):
//  - GET /files/<path under public>?t=<accessToken> serves slips, progress
//    photos, support screenshots and meal photos only to the owner / allowed
//    staff (accessToken header also accepted).
//  - PRIVATE_FILES_PUBLIC (default "true"): while true, /public still serves
//    private files too (old app versions load them from there). Set
//    PRIVATE_FILES_PUBLIC=false once most users are on the new app: then
//    /public/<private file> returns 403 and only /files serves them.
const privateFiles = require("./helper/privateFiles");
console.log(`🔒 Private files: ${privateFiles.privateFilesPublic() ? "ALSO PUBLIC via /public (PRIVATE_FILES_PUBLIC=true)" : "PROTECTED — only via /files (PRIVATE_FILES_PUBLIC=false)"}`);
app.use("/files", require("./routes/FrontSite/privateFiles"));
app.use("/public", privateFiles.publicGuard, express.static("./public"));

// Initializing Server along with creating all the tables that exist in the models folder
db.sequelize.sync().then(async () => {
  // Must run first: the Slot model is paranoid (needs Slots.deletedAt).
  try {
    await require("./migrations/20261026120000-slot-delete-announcement-text").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Slot delete + announcement text columns checked");
  } catch (e) {
    console.error("❌ Slot delete / announcement columns FAILED — classes may not load:", e.message);
  }
  // Safety net (Oct 2026): the class-room / app-version columns MUST exist
  // before any class is served — otherwise every schedule query fails and
  // nobody can join. This migration is idempotent (adds only what's
  // missing), so it's safe on every start.
  try {
    const m = require("./migrations/20261010120000-add-class-rooms");
    await m.up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Class-room columns checked");
    await require("./helper/classRoomSettings").load();
    // Admin-set free trial length (AppSettings "trialDays").
    await require("./helper/trialDaysSetting").load();
  } catch (e) {
    console.error("❌ Class-room columns check FAILED — run: node scripts/checkDbColumns.js --apply", e.message);
  }
  // Growth analytics columns (signup source/method, last login). Same
  // safety net: the User model reads them, so they must exist.
  try {
    await require("./migrations/20261020120000-add-growth-fields").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Growth analytics columns checked");
  } catch (e) {
    console.error("❌ Growth analytics columns check FAILED:", e.message);
  }
  try {
    await require("./migrations/20261022120000-add-onboarding-fields").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Sign-up questions columns checked");
  } catch (e) {
    console.error("❌ Sign-up questions columns check FAILED:", e.message);
  }
  // Login security: Users.tokenVersion (logout / password change revokes
  // tokens) + OtpData.otpTries. The User model reads tokenVersion.
  try {
    await require("./migrations/20261028120000-add-login-security").up(db.sequelize.getQueryInterface(), db.Sequelize, db);
    console.log("✅ Login security columns checked");
  } catch (e) {
    console.error("❌ Login security columns FAILED:", e.message);
  }
  // Plan type (diet / workout / combined) for every plan, from its
  // category. Decides which health-form questions she gets.
  try {
    const r = await require("./migrations/20261029120000-backfill-plan-type").up(db.sequelize.getQueryInterface(), db.Sequelize, db);
    if (r.changed.length) console.log(`✅ Plan types filled: ${r.changed.join(", ")}`);
    else console.log("✅ Plan types checked");
  } catch (e) {
    console.error("❌ Plan type backfill FAILED:", e.message);
  }
  // "Need help" on the diet check-in: new escalation type (admin alert).
  try {
    await require("./migrations/20261031130000-escalation-diet-checkin-help").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Escalation types checked");
  } catch (e) {
    console.error("❌ Escalation types FAILED:", e.message);
  }
  // Consultation on hold while payment unconfirmed (Oct 2026).
  try {
    await require("./migrations/20261104120000-appointment-payment-hold").up(db.sequelize.getQueryInterface(), db.Sequelize, db);
    console.log("✅ Appointment payment hold checked");
  } catch (e) {
    console.error("❌ Appointment payment hold FAILED:", e.message);
  }
  // Attendance from app taps (Oct 2026).
  try {
    await require("./migrations/20261105120000-appointment-join-taps").up(db.sequelize.getQueryInterface(), db.Sequelize, db);
    console.log("✅ Appointment join taps checked");
  } catch (e) {
    console.error("❌ Appointment join taps FAILED:", e.message);
  }
  // Trainer's reason when she cancels a class (Nov 2026, class diary).
  try {
    await require("./migrations/20261106120000-class-session-cancel-reason").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Class cancel reason checked");
  } catch (e) {
    console.error("❌ Class cancel reason FAILED:", e.message);
  }
  // "Why did you leave early?" answer (Nov 2026, class feedback).
  try {
    await require("./migrations/20261107120000-class-feedback-early-reason").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Class feedback early reason checked");
  } catch (e) {
    console.error("❌ Class feedback early reason FAILED:", e.message);
  }
  // Cycle learning column (Oct 2026, helper/cycleLearning.js).
  try {
    await require("./migrations/20261103120000-cycle-learning").up(db.sequelize.getQueryInterface(), db.Sequelize, db);
    console.log("✅ Cycle learning checked");
  } catch (e) {
    console.error("❌ Cycle learning FAILED:", e.message);
  }
  // Dietitian emergency days table + escalation type (Oct 2026).
  try {
    await require("./migrations/20261101130000-dietitian-emergency-days").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Dietitian emergency days checked");
  } catch (e) {
    console.error("❌ Dietitian emergency days FAILED:", e.message);
  }
  // Dietitian late alert column (the Appointment model reads it).
  try {
    await require("./migrations/20261101120000-appointment-dietitian-late").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Appointment late-alert column checked");
  } catch (e) {
    console.error("❌ Appointment late-alert column FAILED:", e.message);
  }
  // Audit fixes: diet updates switch + hidden bell items (the models read them).
  try {
    await require("./migrations/20261031120000-notif-diet-and-hide").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Notification columns checked");
  } catch (e) {
    console.error("❌ Notification columns FAILED:", e.message);
  }
  // One weekly check-in: extra WeeklyCheckins columns (the model reads them).
  try {
    await require("./migrations/20261030120000-weekly-checkin-v2").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Weekly check-in columns checked");
  } catch (e) {
    console.error("❌ Weekly check-in columns FAILED:", e.message);
  }
  try {
    await require("./migrations/20261024120000-add-payment-verify").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ Payment check columns checked");
  } catch (e) {
    console.error("❌ Payment check columns FAILED:", e.message);
  }
  // Payment accounts: first start adds Fit Her's three accounts.
  try {
    if (await require("./helper/paymentAccounts").ensureSeed()) console.log("✅ Payment accounts added");
  } catch (e) {
    console.error("❌ Payment accounts seed FAILED:", e.message);
  }
  const serverPort = process.env.PORT || 3001;
  server.listen(serverPort,"0.0.0.0", () => {
    console.log(`🚀 Server + Socket running on http://localhost:${serverPort}`);
  });
});
