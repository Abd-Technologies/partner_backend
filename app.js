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
// Record every console.error into system_errors (+ optional webhook alert).
require("./helper/errorMonitor").install({ sequelize: db.sequelize, role: process.env.RUN_JOBS || "all" });
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
  sendLunaDailyNudges,
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


// Scheduled jobs live in jobs/scheduler.js (Nov 2026). RUN_JOBS decides
// which run in THIS process: all (default — everything, as before) | web
// (only jobs that push live socket updates; run worker.js for the rest) | none.
// Every job takes a database lock, so several instances never double-run one.
require("./jobs/scheduler").start({ mode: process.env.RUN_JOBS || "all" });

// CORS (Nov 2026): when CORS_ORIGINS is set (comma-separated, e.g.
// "https://thefither.com,https://analytics.thefither.com"), browsers may call
// this API only from those sites. The mobile app and server-to-server calls
// send no Origin header and are not affected. Unset = any site (old behaviour).
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
if (!CORS_ORIGINS.length) {
  console.warn("[security] CORS_ORIGINS not set: any website can call this API from a browser");
}
app.use(cors(CORS_ORIGINS.length
  ? { origin: (origin, cb) => cb(null, !origin || CORS_ORIGINS.includes(origin)) }
  : {}));

// Basic security headers, without adding a dependency.
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  next();
});

// Slip photos from the CRM come as base64 (up to 8 MB image → ~11 MB JSON).
// Only this route gets the bigger limit; everything else keeps the default.
app.use("/internal/crm/payment-slips", express.json({ limit: "12mb" }));
app.use(express.json());

//for form data and multipart data
app.use(bodyParser.urlencoded({ extended: true }));

// app.use(upload.array());

app.use("/users", userRoute);
app.use(require("./routes/health"));   // /health + /admin/health
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
  // CRM outbox table + indexes (Nov 2026). Idempotent. Failing here only
  // delays CRM events (helper/crmEvents.js keeps retrying), never the app.
  try {
    await require("./migrations/20261111120000-crm-outbox").up(db.sequelize.getQueryInterface(), db.Sequelize);
    console.log("✅ CRM outbox table checked");
  } catch (e) {
    console.error("❌ CRM outbox table check FAILED — CRM events wait until fixed:", e.message);
  }
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
  // Join / leave times from the app (Nov 2026).
  try {
    await require("./migrations/20261108120000-appointment-attendance-times").up(db.sequelize.getQueryInterface(), db.Sequelize, db);
    console.log("✅ Appointment attendance times checked");
  } catch (e) {
    console.error("❌ Appointment attendance times FAILED:", e.message);
  }
  // Dietitian's note to the client on her plan (Nov 2026).
  try {
    await require("./migrations/20261109120000-diet-plan-client-note").up(db.sequelize.getQueryInterface(), db.Sequelize, db);
    console.log("✅ Diet plan client note checked");
  } catch (e) {
    console.error("❌ Diet plan client note FAILED:", e.message);
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
