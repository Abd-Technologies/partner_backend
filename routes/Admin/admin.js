const express = require("express");
const router = express();
const multer = require("multer");
const path = require("path");
const { validateToken } = require("../../middlewares/AuthorizationMW");
const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const {
  requireRole,
  requireAdmin,
  requireAdminOrSupport,
  selfOrStaff,
  signupGuard,
  userTypeListGuard,
} = require("../../middlewares/roleGuards");
const { ownClientOnly } = require("../../helper/dietitianScope");
// Login / reset-code / sign-up rate limits (Oct 2026, helper/rateLimit.js).
const { loginLimit, otpLimit, signupLimit } = require("../../helper/rateLimit");
const asyncMiddleware = require("../../middlewares/async");
const adminController = require("../../controllers/Admin/AdminController");
const dietitianDashboardController = require("../../controllers/Admin/dietitianDashboardController");
let x = 1;
const uploadimage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, `./public/images`);
  },
  filename: (req, file, cb) => {
    cb(
      null,
      file.fieldname +
        "-" +
        Math.floor(Math.random() * 1000000000) +
        "-" +
        path.extname(file.originalname)
    );
  },
});
const upload = multer({
  storage: uploadimage,
  // Oct 2026 security audit: images / PDF only, 15 MB (helper/uploadRules.js).
  fileFilter: require("../../helper/uploadRules").filter({ allowPdf: true }),
  limits: require("../../helper/uploadRules").limits,
});

// Per-dietitian consultation dashboard. Returns counts (completed,
// on-time vs ran-over, cancellations) plus per-day breakdown and
// recent reviews. Admin-gated; default range is last 30 days, override
// with ?from=YYYY-MM-DD&to=YYYY-MM-DD.
router.get(
  "/dietitian-dashboard/:dietitianId",
  validateToken,
  validateAdmin,
  asyncMiddleware(dietitianDashboardController.getDietitianConsultationDashboard)
);

// Oct 2026 auth audit: every route below now has a guard. Only these stay
// public on purpose: login, socialLogin, guestLogin, sendOtp, verifyOtp,
// server-time, getAnnouncement, get_testimonials, and addUser (signup,
// limited by signupGuard). See middlewares/roleGuards.js.
router.post("/registration", requireRole("Admin"), asyncMiddleware(adminController.registration));
router.post("/payment", validateToken, asyncMiddleware(adminController.payment));
router.post(
  "/payment_success",
  validateToken,
  selfOrStaff("body.userId"),
  asyncMiddleware(adminController.payment_success)
);
router.get(
  "/login_check",
  validateToken,
  asyncMiddleware(adminController.login_check)
);
router.post("/login", loginLimit, asyncMiddleware(adminController.login));
router.post("/socialLogin", loginLimit, asyncMiddleware(adminController.socialLogin));

router.post(
  "/admin_get_profile",
  validateToken,
  asyncMiddleware(adminController.admin_get_profile)
);
router.post(
  "/admin_edit_profile",
  validateToken,
  asyncMiddleware(adminController.admin_edit_profile)
);
// Sec pass 1 (Oct 2026): plans, money, team and broadcasts are Admin only.
router.post("/add_plan", validateToken, requireAdmin, asyncMiddleware(adminController.add_plan));
router.post("/update_plan", validateToken, requireAdmin, asyncMiddleware(adminController.update_plan));

router.get("/get_plans/:code", validateToken, asyncMiddleware(adminController.get_plans));
router.get("/get_plans", validateToken, asyncMiddleware(adminController.get_plans_admin));

// (Removed a second "/update_plan" registration -> edit_plan. Express
// always ran the one above first, so it was dead code with no role check.)

router.post(
  "/addImage",
  validateToken,
  upload.single("image"),
  asyncMiddleware(adminController.addImage)
);
router.get(
  "/getAllPlanImages",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.getAllPlanImages)
);
router.post(
  "/add_testimonial",
  validateToken,
  requireAdmin,
  upload.single("image"),
  asyncMiddleware(adminController.add_testimonial)
);
// LEGACY PDF DIET PLAN — disabled. The AI DietPlan flow is the only plan system now. Kept commented (not deleted) in case it's ever needed again.
// router.post(
//   "/addDietPdf",
//   upload.single("image"),
//   asyncMiddleware(adminController.addDietPdf)
// );

router.get(
  "/get_testimonials",
  asyncMiddleware(adminController.get_testimonials)
);
// LEGACY PDF DIET PLAN — disabled. The AI DietPlan flow is the only plan system now. Kept commented (not deleted) in case it's ever needed again.
// router.post(
//   "/getDietPdf",
//   asyncMiddleware(adminController.getDietPdf)
// );
router.post(
  "/activate_plan",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.activate_plan)
);
router.post(
  "/block_plan",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.block_plan)
);
router.post(
  "/activate_user",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.activate_user)
);
router.get("/get_all_users", validateToken, requireAdmin, asyncMiddleware(adminController.get_all_users));
router.get(
  "/get_all_dietitions",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.get_all_dietitions)
);
router.get(
  "/get_all_trainers",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.get_all_trainers)
);
router.post(
  "/block_user",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.block_user)
);
router.get(
  "/dashboard",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.dashboard)
);
router.get(
  "/users_plans",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.users_plans)
);
router.get(
  "/get_all_plans",
  validateToken,
  asyncMiddleware(adminController.get_all_plans)
);
// (Removed a duplicate "/dashboard" registration.)

router.post(
  "/add_service",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.add_service)
);
router.post(
  "/update_service",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.update_service)
);
router.get(
  "/get_all_services",
  validateToken,
  asyncMiddleware(adminController.get_all_services)
);
router.post(
  "/activate_service",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.activate_service)
);
router.post(
  "/block_service",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.block_service)
);

router.post(
  "/add_category",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.add_category)
);
router.post(
  "/udpate_category",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.udpate_category)
);
router.get("/all_categories", validateToken, asyncMiddleware(adminController.all_categories));
router.get(
  "/get_subcategories/:categoryId",
  validateToken,
  asyncMiddleware(adminController.get_subcategories)
);
router.get(
  "/get_all_contact_messages",
  validateToken,
  requireAdminOrSupport,
  asyncMiddleware(adminController.get_all_contact_messages)
);
router.get(
  "/dieitionPlans",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.dieitionPlans)
);
router.post(
  "/update_dietition_link",
  validateToken,
  requireRole("Admin", "Dietition"),
  asyncMiddleware(adminController.update_dietition_link)
);
router.post(
  "/update_trainer_link",
  validateToken,
  requireRole("Admin", "Trainer"),
  asyncMiddleware(adminController.update_trainer_link)
);
router.get(
  "/dietitionHome/:userId",
  validateAdmin,
  selfOrStaff("params.userId", ["Admin"]),
  asyncMiddleware(adminController.dietitionHome)
);
router.get(
  "/getAllDeititions",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.getAllDeititions)
);
router.get(
  "/getAllActivePlans",
  validateAdmin,
  asyncMiddleware(adminController.getAllActivePlans)
);

router.post("/addUser", signupGuard(), signupLimit, asyncMiddleware(adminController.addUser));
router.post("/updateUser", validateToken, requireAdmin, asyncMiddleware(adminController.updateUser));
router.post("/addTeamMember", validateToken, requireAdmin, asyncMiddleware(adminController.addTeamMember));
router.post("/addTrainer", validateToken, requireAdmin, asyncMiddleware(adminController.addTrainer));
router.post(
  "/addAnnouncement",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.addAnnouncement)
);
router.get(
  "/trainerHome/:userId",
  validateToken,
  asyncMiddleware(adminController.trainerHome)
);
router.get("/userHome/:userId/:code", validateToken, selfOrStaff("params.userId"), asyncMiddleware(adminController.userHome));
router.get("/userReports", validateToken, requireAdmin, asyncMiddleware(adminController.userReports));
// Lightweight slot status — used by the workout schedule heartbeat. Returns
// only the few fields that drive button/badge state so we can poll cheaply.
router.get(
  "/slot/:id/status",
  validateToken,
  asyncMiddleware(adminController.slotStatus)
);

// Server time — Flutter AppClock fetches this once at app launch to
// compute (server - device) offset. Defends against device clocks that
// are wrong or out of sync. No auth: it's just the wall clock.
router.get("/server-time", asyncMiddleware(adminController.serverTime));
// App update popup rules (admin sets latest / minimum version per platform).
router.post("/app-version", validateToken, asyncMiddleware(require("../../controllers/appVersionController").setAppVersion));
router.get("/app-version/audience", validateToken, asyncMiddleware(require("../../controllers/appVersionController").appUpdateAudience));
router.post("/app-version/notify", validateToken, asyncMiddleware(require("../../controllers/appVersionController").notifyAppUpdate));
router.post(
  "/updateLink",
  validateToken,
  asyncMiddleware(adminController.updateLink)
);
router.post(
  "/updateDietitionLink",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.updateDietitionLink)
);
// Lists the logged-in dietitian's own consultation slot templates
// (day/time + whatever link is currently saved), so the link tool page
// has something to show her. Scoped to req.user.id — she can only ever
// see and edit her own slots, never another dietitian's.
router.get(
  "/my-diet-slots",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.getMyDietSlots)
);
// Lists the logged-in dietitian's own upcoming confirmed bookings, so
// the link tool page can show a "Start This Session" button per real
// appointment (separate from the recurring slot templates above).
router.get(
  "/my-upcoming-consultations",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.getMyUpcomingConsultations)
);
router.post("/addReport", validateToken, selfOrStaff("body.userId"), asyncMiddleware(adminController.addReport));
router.get(
  "/getAnnouncement",
  asyncMiddleware(adminController.getAnnouncement)
);
// Admin freezes a client's plan. Clients freeze their own plan through
// POST /users/plan/freeze (planFreezeController), not this route.
router.post("/freeze", validateToken, requireAdmin, asyncMiddleware(adminController.freeze));
// Cancels an active paid subscription (UserPlan) — see
// AdminController.cancelUserPlan for why this endpoint didn't exist
// before. :id is the UserPlan id, not the User id.
router.post(
  "/user-plan/:id/cancel",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.cancelUserPlan)
);
// Was open to anyone (Oct 2026 review audit): now login required, and the
// review is saved for the logged-in user, not a userId from the body.
router.post("/addReview", validateToken, asyncMiddleware(adminController.addReview));
router.get("/getReviews", validateAdmin, asyncMiddleware(adminController.getReviews));
// Class feedback for admin (fitHer Flows › Class feedback)
router.get("/classFeedback", validateToken, require("../../controllers/FrontSite/classFeedbackController").adminList);
router.get("/syncrhonize", validateToken, requireAdmin, asyncMiddleware(adminController.syncrhonize));
// Own account (Delete Account in the app) or an admin. Checked in the controller.
router.post("/delete_user", validateToken, asyncMiddleware(adminController.delete_user));

router.post("/sendOtp", otpLimit, asyncMiddleware(adminController.sendOtp));
router.post("/verifyOtp", otpLimit, asyncMiddleware(adminController.verifyOtp));
router.post("/updatePassword", validateToken, selfOrStaff("body.userId", ["Admin"]), asyncMiddleware(adminController.updatePassword));
router.post("/guestLogin", loginLimit, asyncMiddleware(adminController.guestLogin));
router.get("/getGuest", validateToken, requireAdmin, asyncMiddleware(adminController.getGuest));
router.post("/approvedImage", validateToken, requireAdmin, asyncMiddleware(adminController.approvedImage));
router.post(
  "/sendNotification_to_all_users",
  requireRole("Admin"),
  asyncMiddleware(adminController.sendNotification_to_all_users)
);
router.get(
  "/get_subcategories_based_on_user_types/:userType",
  validateToken,
  asyncMiddleware(adminController.get_subcategories_based_on_user_types)
);
router.get(
  "/get_users_based_on_types/:userType",
  validateToken,
  userTypeListGuard(),
  asyncMiddleware(adminController.get_users_based_on_types)
);
router.get(
  "/get_plans_based_on_sub_categories/:subCategoryId",
  validateToken,
  asyncMiddleware(adminController.get_plans_based_on_sub_categories)
);
router.get("/workout_plans", validateToken, asyncMiddleware(adminController.workout_plans));
router.post(
  "/assign_workout_diet_plan",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.assign_workout_diet_plan)
);
router.post(
  "/dietition_add_plan",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.dietition_add_plan)
);

router.post(
  "/update_user",
  validateToken,
  upload.single("image"),
  selfOrStaff("body.userId"),
  asyncMiddleware(adminController.update_user)
);
router.post(
  "/addTip",
  requireRole("Admin"),
  upload.single("image"),
  asyncMiddleware(adminController.addTip)
);
router.post(
  "/addDiet",
  validateToken,
  requireRole("Admin", "Dietition"),
  ownClientOnly("body.userId"),
  asyncMiddleware(adminController.addDiet)
);
router.get(
  "/dietitionPlans/:id",
  validateAdmin,
  asyncMiddleware(adminController.dietitionPlans)
);
router.get(
  "/userDietPlans/:userId",
  validateToken,
  selfOrStaff("params.userId"),
  asyncMiddleware(adminController.userDietPlans)
);
router.get(
  "/getProgressImages/:userId",
  validateToken,
  selfOrStaff("params.userId"),
  asyncMiddleware(adminController.getProgressImages)
);
router.get(
  "/dietPlanDetails/:userPlanId",
  validateToken, // ownership (client / her dietitian / Admin) checked in the controller
  asyncMiddleware(adminController.dietPlanDetails)
);
router.get(
  "/workout_plan_details/:id/:userId/:showSlots",
  validateToken,
  selfOrStaff("params.userId"),
  asyncMiddleware(adminController.workout_plan_details)
);
router.get(
  "/user_workout_plans/:userId",
  validateToken,
  selfOrStaff("params.userId"),
  asyncMiddleware(adminController.user_workout_plans)
);
router.get(
  "/getTeamMember",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.getTeamMember)
);
router.get(
  "/getFreePlan",
  validateToken,
  asyncMiddleware(adminController.getFreePlan)
);
router.get(
  "/getAllHealthTips",
  validateToken,
  asyncMiddleware(adminController.getAllHealthTips)
);
router.post(
  "/changeFreeTrialStatus",
  validateToken,
  validateAdmin,
  asyncMiddleware(adminController.changeFreeTrialStatus)
);
router.post(
  "/addProgressImages",
  validateToken,
  upload.fields([
    { name: "before", maxCount: 1 },
    { name: "after", maxCount: 1 },
  ]),
  selfOrStaff("body.userId"),
  asyncMiddleware(adminController.addProgressImages)
);

router.get(
  "/userCount",
  validateAdmin, // was open to anyone (Oct 2026 audit)
  asyncMiddleware(adminController.userCount)
);
router.post(
  "/completeDietPlan",
  validateToken,
  requireRole("Admin", "Dietition"),
  asyncMiddleware(adminController.completeDietPlan)
);
router.post(
  "/add_slots",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.add_slots)
);
router.post("/slots/:id/delete", validateToken, requireAdmin, asyncMiddleware(require("../../controllers/Admin/slotAdminController").remove));
router.post(
  "/update_slots",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.update_slots)
);
router.post(
  "/update_slot_trainer",
  validateAdmin, // was open to anyone (Oct 2026 audit)
  asyncMiddleware(adminController.update_slot_trainer)
);
router.post(
  "/addDietitionReview",
  validateAdmin, // was open to anyone (Oct 2026 audit)
  asyncMiddleware(adminController.addDietitionReview)
);
router.post(
  "/updateTrainerJoin",
  validateToken,
  validateAdmin, // trainer: own slot only (checked in the controller); Admin: any
  asyncMiddleware(adminController.updateTrainerJoin)
);
router.get(
  "/getRating/:dietitianId",
  validateAdmin, // was open to anyone (Oct 2026 audit)
  asyncMiddleware(adminController.getRating)
);
router.get(
  "/getAllCustomSupporters/:userId",
  validateAdmin,
  selfOrStaff("params.userId", ["Admin"]), // a support rep sees only her own clients
  asyncMiddleware(adminController.getAllCustomSupporters)
);
router.get(
  "/getAllTimesWithSlots",
  validateToken,
  requireAdmin,
  asyncMiddleware(adminController.getAllTimesWithSlots)
);
router.get(
  "/sendNotificationTest",
  requireRole("Admin"),
  asyncMiddleware(adminController.sendNotificaionTest));
router.get(
  "/sendNotificaionTest",
  requireRole("Admin"),
  asyncMiddleware(adminController.sendNotificaionTest));
  
  
router.post("/assignFreePlan", validateToken, requireAdmin, asyncMiddleware(adminController.assignFreePlan));
router.post("/addUserDetails", validateToken, selfOrStaff("body.userId"), asyncMiddleware(adminController.addUserDetails));

// Legacy free-trial form: a client may only fill it in for herself.
router.post('/createFreeTrialUser', validateToken, selfOrStaff("body.freeTrialUser", ["Admin"]), asyncMiddleware(adminController.createFreeTrialUser));
// Trial rosters: the trainer herself (:id = trainerId) or Admin.
router.get('/getFreeTrialUserById/:id/:slotId', validateToken, selfOrStaff("params.id", ["Admin"]), asyncMiddleware(adminController.getFreeTrialUserById));
// Trainer roster for the current (TrialJourney) free-trial system — the
// route above only ever reads the legacy FreeTrailUsersSlots table, which
// nothing has written to since trialController.js shipped.
router.get('/getTrialJourneyUsersBySlot/:id/:slotId', validateToken, selfOrStaff("params.id", ["Admin"]), asyncMiddleware(adminController.getTrialJourneyUsersBySlot));
// Class rooms: admin sets each trainer's Zoom room once; trainer screen
// reads its class + sets an "Other link" for today. controllers/Admin/classLinkController.js
const classLinkController = require("../../controllers/Admin/classLinkController");
router.get('/trainerRooms', validateToken, asyncMiddleware(classLinkController.trainerRooms));
router.post('/trainerRoom', validateToken, requireAdmin, asyncMiddleware(classLinkController.setTrainerRoom));
router.post('/mainClassRoom', validateToken, requireAdmin, asyncMiddleware(classLinkController.setMainRoom));
// Free trial length (Oct 2026): admin sets it; .env TRIAL_DAYS is the default.
const trialSettingsController = require("../../controllers/Admin/trialSettingsController");
router.get('/trialDays', validateToken, requireAdmin, asyncMiddleware(trialSettingsController.getTrialDaysSetting));
router.post('/trialDays', validateToken, requireAdmin, asyncMiddleware(trialSettingsController.setTrialDaysSetting));
// Growth dashboard (admin analytics, exact facts). See growth.md.
const growth = require("../../controllers/Admin/growthController");
// Fit Her payment accounts (admin adds / edits; slips are checked against them).
{
  const pac = require("../../controllers/Admin/paymentAccountController");
  router.get("/payment-accounts", validateToken, asyncMiddleware(pac.listAll));
  router.post("/payment-accounts", validateToken, asyncMiddleware(pac.create));
  router.post("/payment-accounts/:id", validateToken, asyncMiddleware(pac.update));
}
// AI-approved payments the admin confirms within 48 h (helper/paymentVerify.js).
{
  const pcc = require("../../controllers/Admin/paymentCheckController");
  router.get("/payment-checks", validateToken, asyncMiddleware(pcc.list));
  router.post("/payment-checks/:id", validateToken, asyncMiddleware(pcc.decide));
}
router.get("/growth/overview", validateToken, growth.overview);
router.get("/growth/signup", validateToken, growth.signup);
router.get("/growth/workout", validateToken, growth.workout);
router.get("/growth/revenue", validateToken, growth.revenue);
router.get("/growth/retention", validateToken, growth.retention);
router.get("/growth/list/:key", validateToken, growth.list);
router.get("/growth/trends", validateToken, growth.trends);
// Symptom check results for staff (dietitian client profile / admin).
router.get("/healthScreening/:userId", validateAdmin, require("../../helper/dietitianScope").ownClientOnly("userId"), asyncMiddleware(require("../../controllers/FrontSite/userController").staff_health_screening));
router.get('/trainerClass/:slotId', validateToken, asyncMiddleware(classLinkController.trainerClass));
router.post('/trainerClass/backupLink', validateToken, asyncMiddleware(classLinkController.setBackupLink));
router.post(
  '/updateSlotStatus',
  validateToken,
  asyncMiddleware(adminController.update_slot_status)
);
// LEGACY PDF DIET PLAN — disabled. The AI DietPlan flow is the only plan system now. Kept commented (not deleted) in case it's ever needed again.
// router.put('/updateDietPlanStatus/:id', asyncMiddleware(adminController.updateDietPlanStatus));
// router.get('/getDietPlanStatus', asyncMiddleware(adminController.getDietPlanStatus));

// ─── Trial admin overrides ───────────────────────────────────────────────────
// POST /admin/trial/force-attendance
// Manually marks a trial day as attended for a user who is stuck in the
// "booked but never attended" deadlock (e.g. app crashed before leave API fired).
// Body: { userId, day }  — day must be 1, 2, or 3.
// Auth: validateToken + validateAdmin
const trialAdminController = require("../../controllers/Admin/trialAdminController");
router.post(
  "/trial/force-attendance",
  validateToken,
  validateAdmin,
  asyncMiddleware(trialAdminController.forceAttendance)
);

// ─── Identity / session helper ──────────────────────────────────────────────
// Used by the CRM dashboard (and any external system) to verify a session JWT
// issued by /admin/login and fetch the current user's profile + role.
// Auth: validateToken middleware → verifies with JWT_ACCESS_SECRET.
// Header: accessToken: <jwt>
router.get("/me", validateToken, asyncMiddleware(adminController.me));

// ─── Trial deep-link token system (sales rep) ───────────────────────────────
// Reps create shareable deep links that auto-start a 3-day TrialJourney when
// the target user taps the link and opens / installs the app.
//
// Deep-link format: https://backend.thefither.com/trial?token=<token>
// Flutter AppLinkHandler detects "trial" + "token" → validates → starts trial.
//
// POST   /admin/create-trial-token          – generate a new token + link
// GET    /admin/my-trial-tokens             – list this rep's tokens (paginated)
// DELETE /admin/revoke-trial-token/:token   – kill a link before it's used
//
// Auth: validateToken only (all rep roles: Customer_Support_Representative,
//       Trainer, Admin, etc. — anyone with a valid JWT can create links).
const trialTokenController = require("../../controllers/FrontSite/trialTokenController");

// Sec pass 1: staff only (the Trial links screen is on the support home).
router.post(
  "/create-trial-token",
  validateToken,
  validateAdmin,
  asyncMiddleware(trialTokenController.createTrialToken)
);

router.get(
  "/my-trial-tokens",
  validateToken,
  validateAdmin,
  asyncMiddleware(trialTokenController.listMyTrialTokens)
);

router.delete(
  "/revoke-trial-token/:token",
  validateToken,
  asyncMiddleware(trialTokenController.revokeTrialToken)
);

// Trial starter plans the AI hasn't made yet (Oct 2026): list + Retry.
// Admin and customer support (portal "Plans waiting / failed").
const trialPlans = require("../../controllers/FrontSite/trialDietPlanController");
router.get("/trial-plans/waiting", validateToken, requireAdminOrSupport, asyncMiddleware(trialPlans.adminListWaiting));
router.post("/trial-plans/:userId/retry", validateToken, requireAdminOrSupport, asyncMiddleware(trialPlans.adminRetry));

module.exports = router;
