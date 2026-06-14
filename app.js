require("dotenv").config();
const { init,getIO } = require("./socket");
const express = require("express");
const app = express();

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
const escalationAdminRoutes = require('./routes/Admin/escalation')
const metricsAdminRoutes = require('./routes/Admin/metrics')
const trialRoutes = require('./routes/FrontSite/trial')
const dietPlanAdminRoutes = require('./routes/Admin/dietPlan')
const magicLinkRoutes = require('./routes/FrontSite/magicLink')
const dietPlanUserRoutes = require('./routes/FrontSite/dietPlan')



const { Server } = require("socket.io"); // FIX: Import Server from socket.io

const  { sendUpcomingSlotNotificationsPerUser } = require('./helper/crownjobfunction')




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
const { autoUnfreezeExpiredPlans } = require("./helper/autoUnfreezeExpiredPlans");
const { sendMissedSessionRecovery } = require("./helper/missedSessionRecovery");
const popupEligibility = require("./helper/popupEligibility");


// All workout-flow crons run on PKT — slot wall-clocks are stored as
// AM/PM PKT, so anchoring the schedules to PKT is the only way the
// daily reset, the auto-end grace window, and the FCM cadence line up
// with what users actually see. Without this, the cron runs at the
// host's local time (UTC on most VPS deployments) which is +5h off.
const CRON_TZ = "Asia/Karachi";

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

// Missed-session recovery. Runs hourly and sends at most one nudge per
// user/local day after their final scheduled class has been over for 30
// minutes and no attendance was recorded. Preference-gated by
// NotificationPreference.missedRecovery in helper/notification.js.
cron.schedule(
  "17 * * * *",
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

// Consultation-flow: per-minute consultant-no-show check. Looks for
// confirmed appointments whose scheduled time + 10 min grace has passed
// without the dietitian flipping status to "In Progress". Marks the user
// eligible for POPUP_CONSULTANT_NO_SHOW so the dashboard surfaces the
// "report no-show" prompt next time the user opens the app. The actual
// CONSULT_NO_SHOW escalation only fires when the user taps "report" via
// POST /appointment/:id/no-show — we don't auto-escalate here because a
// dietitian could still join after grace.
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
app.use('/admin/escalations', escalationAdminRoutes);
app.use('/admin/metrics', metricsAdminRoutes);
app.use('/trial', trialRoutes);
app.use('/admin/diet-plan', dietPlanAdminRoutes);
app.use('/users/diet-plan', dietPlanUserRoutes);





// app.use
// Error middleware : To show any error if promise fails
app.use(error);
// To make the folder Public
app.use("/public", express.static("./public"));

// Initializing Server along with creating all the tables that exist in the models folder
db.sequelize.sync().then(() => {
  const serverPort = process.env.PORT || 3001;
  server.listen(serverPort,"0.0.0.0", () => {
    console.log(`🚀 Server + Socket running on http://localhost:${serverPort}`);
  });
});
