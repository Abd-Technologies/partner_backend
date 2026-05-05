const express = require("express");
const router = express();
const multer = require("multer");
const path = require("path");
const { validateToken } = require("../../middlewares/AuthorizationMW");
const { validateAdmin } = require("../../middlewares/ValidateAdmin");
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

router.post("/registration", asyncMiddleware(adminController.registration));
router.post("/payment", asyncMiddleware(adminController.payment));
router.post(
  "/payment_success",
  asyncMiddleware(adminController.payment_success)
);
router.get(
  "/login_check",
  validateToken,
  asyncMiddleware(adminController.login_check)
);
router.post("/login", asyncMiddleware(adminController.login));
router.post("/socialLogin", asyncMiddleware(adminController.socialLogin));

router.post(
  "/admin_get_profile",
  asyncMiddleware(adminController.admin_get_profile)
);
router.post(
  "/admin_edit_profile",
  asyncMiddleware(adminController.admin_edit_profile)
);
router.post("/add_plan", validateAdmin, asyncMiddleware(adminController.add_plan));
router.post("/update_plan", validateAdmin, asyncMiddleware(adminController.update_plan));

router.get("/get_plans/:code", asyncMiddleware(adminController.get_plans));
router.get("/get_plans", asyncMiddleware(adminController.get_plans_admin));

router.post(
  "/update_plan",
  upload.single("image"),
  validateToken,
  asyncMiddleware(adminController.edit_plan)
);

router.post(
  "/addImage",
  upload.single("image"),
  asyncMiddleware(adminController.addImage)
);
router.get(
  "/getAllPlanImages",
  asyncMiddleware(adminController.getAllPlanImages)
);
router.post(
  "/add_testimonial",
  upload.single("image"),
  asyncMiddleware(adminController.add_testimonial)
);
router.post(
  "/addDietPdf",
  upload.single("image"),
  asyncMiddleware(adminController.addDietPdf)
);

router.get(
  "/get_testimonials",
  asyncMiddleware(adminController.get_testimonials)
);
router.post(
  "/getDietPdf",
  asyncMiddleware(adminController.getDietPdf)
);
router.post(
  "/activate_plan",
  validateToken,
  asyncMiddleware(adminController.activate_plan)
);
router.post(
  "/block_plan",
  validateToken,
  asyncMiddleware(adminController.block_plan)
);
router.post(
  "/activate_user",
  validateToken,
  asyncMiddleware(adminController.activate_user)
);
router.get("/get_all_users", asyncMiddleware(adminController.get_all_users));
router.get(
  "/get_all_dietitions",
  validateToken,
  asyncMiddleware(adminController.get_all_dietitions)
);
router.get(
  "/get_all_trainers",
  validateToken,
  asyncMiddleware(adminController.get_all_trainers)
);
router.post(
  "/block_user",
  validateToken,
  asyncMiddleware(adminController.block_user)
);
router.get(
  "/dashboard",
  validateToken,
  asyncMiddleware(adminController.dashboard)
);
router.get(
  "/users_plans",
  validateToken,
  asyncMiddleware(adminController.users_plans)
);
router.get(
  "/get_all_plans",
  validateToken,
  asyncMiddleware(adminController.get_all_plans)
);
router.get(
  "/dashboard",
  validateToken,
  asyncMiddleware(adminController.dashboard)
);

router.post(
  "/add_service",
  validateToken,
  asyncMiddleware(adminController.add_service)
);
router.post(
  "/update_service",
  validateToken,
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
  asyncMiddleware(adminController.activate_service)
);
router.post(
  "/block_service",
  validateToken,
  asyncMiddleware(adminController.block_service)
);

router.post(
  "/add_category",
  validateToken,
  asyncMiddleware(adminController.add_category)
);
router.post(
  "/udpate_category",
  validateToken,
  asyncMiddleware(adminController.udpate_category)
);
router.get("/all_categories", asyncMiddleware(adminController.all_categories));
router.get(
  "/get_subcategories/:categoryId",
  asyncMiddleware(adminController.get_subcategories)
);
router.get(
  "/get_all_contact_messages",
  validateToken,
  asyncMiddleware(adminController.get_all_contact_messages)
);
router.get(
  "/dieitionPlans",
  validateToken,
  asyncMiddleware(adminController.dieitionPlans)
);
router.post(
  "/update_dietition_link",
  validateToken,
  asyncMiddleware(adminController.update_dietition_link)
);
router.post(
  "/update_trainer_link",
  validateToken,
  asyncMiddleware(adminController.update_trainer_link)
);
router.get(
  "/dietitionHome/:userId",
  asyncMiddleware(adminController.dietitionHome)
);
router.get(
  "/getAllDeititions",
  asyncMiddleware(adminController.getAllDeititions)
);
router.get(
  "/getAllActivePlans",
  asyncMiddleware(adminController.getAllActivePlans)
);

router.post("/addUser", asyncMiddleware(adminController.addUser));
router.post("/updateUser", validateAdmin, asyncMiddleware(adminController.updateUser));
router.post("/addTeamMember", validateAdmin, asyncMiddleware(adminController.addTeamMember));
router.post("/addTrainer", validateAdmin, asyncMiddleware(adminController.addTrainer));
router.post(
  "/addAnnouncement",
  validateAdmin,
  asyncMiddleware(adminController.addAnnouncement)
);
router.get(
  "/trainerHome/:userId",
  validateToken,
  asyncMiddleware(adminController.trainerHome)
);
router.get("/userHome/:userId/:code", asyncMiddleware(adminController.userHome));
router.get("/userReports", asyncMiddleware(adminController.userReports));
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
router.post(
  "/updateLink",
  validateToken,
  asyncMiddleware(adminController.updateLink)
);
router.post(
  "/updateDietitionLink",
  asyncMiddleware(adminController.updateDietitionLink)
);
router.post("/addReport", asyncMiddleware(adminController.addReport));
router.get(
  "/getAnnouncement",
  asyncMiddleware(adminController.getAnnouncement)
);
router.post("/freeze", validateAdmin, asyncMiddleware(adminController.freeze));
router.post("/addReview", asyncMiddleware(adminController.addReview));
router.get("/getReviews", asyncMiddleware(adminController.getReviews));
router.get("/syncrhonize", asyncMiddleware(adminController.syncrhonize));
router.post("/delete_user", validateAdmin, asyncMiddleware(adminController.delete_user));

router.post("/sendOtp", asyncMiddleware(adminController.sendOtp));
router.post("/verifyOtp", asyncMiddleware(adminController.verifyOtp));
router.post("/updatePassword", asyncMiddleware(adminController.updatePassword));
router.post("/guestLogin", asyncMiddleware(adminController.guestLogin));
router.get("/getGuest", asyncMiddleware(adminController.getGuest));
router.post("/approvedImage", asyncMiddleware(adminController.approvedImage));
router.post(
  "/sendNotification_to_all_users",
  asyncMiddleware(adminController.sendNotification_to_all_users)
);
router.get(
  "/get_subcategories_based_on_user_types/:userType",
  asyncMiddleware(adminController.get_subcategories_based_on_user_types)
);
router.get(
  "/get_users_based_on_types/:userType",
  asyncMiddleware(adminController.get_users_based_on_types)
);
router.get(
  "/get_plans_based_on_sub_categories/:subCategoryId",
  asyncMiddleware(adminController.get_plans_based_on_sub_categories)
);
router.get("/workout_plans", asyncMiddleware(adminController.workout_plans));
router.post(
  "/assign_workout_diet_plan",
  asyncMiddleware(adminController.assign_workout_diet_plan)
);
router.post(
  "/dietition_add_plan",
  validateToken,
  asyncMiddleware(adminController.dietition_add_plan)
);

router.post(
  "/update_user",
  upload.single("image"),
  asyncMiddleware(adminController.update_user)
);
router.post(
  "/addTip",
  upload.single("image"),
  asyncMiddleware(adminController.addTip)
);
router.post("/addDiet", asyncMiddleware(adminController.addDiet));
router.get(
  "/dietitionPlans/:id",
  asyncMiddleware(adminController.dietitionPlans)
);
router.get(
  "/userDietPlans/:userId",
  asyncMiddleware(adminController.userDietPlans)
);
router.get(
  "/getProgressImages/:userId",
  asyncMiddleware(adminController.getProgressImages)
);
router.get(
  "/dietPlanDetails/:userPlanId",
  asyncMiddleware(adminController.dietPlanDetails)
);
router.get(
  "/workout_plan_details/:id/:userId/:showSlots",
  validateToken,
  asyncMiddleware(adminController.workout_plan_details)
);
router.get(
  "/user_workout_plans/:userId",
  asyncMiddleware(adminController.user_workout_plans)
);
router.get(
  "/getTeamMember",
  asyncMiddleware(adminController.getTeamMember)
);
router.get(
  "/getFreePlan",
  asyncMiddleware(adminController.getFreePlan)
);
router.get(
  "/getAllHealthTips",
  asyncMiddleware(adminController.getAllHealthTips)
);
router.post(
  "/changeFreeTrialStatus",
  asyncMiddleware(adminController.changeFreeTrialStatus)
);
router.post(
  "/addProgressImages",
  upload.fields([
    { name: "before", maxCount: 1 },
    { name: "after", maxCount: 1 },
  ]),
  asyncMiddleware(adminController.addProgressImages)
);

router.get(
  "/userCount",
  asyncMiddleware(adminController.userCount)
);
router.post(
  "/completeDietPlan",
  asyncMiddleware(adminController.completeDietPlan)
);
router.post(
  "/add_slots",
  validateAdmin,
  asyncMiddleware(adminController.add_slots)
);
router.post(
  "/update_slots",
  validateAdmin,
  asyncMiddleware(adminController.update_slots)
);
router.post(
  "/update_slot_trainer",
  asyncMiddleware(adminController.update_slot_trainer)
);
router.post(
  "/addDietitionReview",
  asyncMiddleware(adminController.addDietitionReview)
);
router.post(
  "/updateTrainerJoin",
  validateToken,
  asyncMiddleware(adminController.updateTrainerJoin)
);
router.get(
  "/getRating/:dietitianId",
  asyncMiddleware(adminController.getRating)
);
router.get(
  "/getAllCustomSupporters/:userId",
  asyncMiddleware(adminController.getAllCustomSupporters)
);
router.get(
  "/getAllTimesWithSlots",
  asyncMiddleware(adminController.getAllTimesWithSlots)
);
router.get(
  "/sendNotificaionTest",
  asyncMiddleware(adminController.sendNotificaionTest));
  
  
router.post("/assignFreePlan", validateAdmin, asyncMiddleware(adminController.assignFreePlan));
router.post("/addUserDetails", asyncMiddleware(adminController.addUserDetails));

router.post('/createFreeTrialUser', asyncMiddleware(adminController.createFreeTrialUser));
router.get('/getFreeTrialUserById/:id/:slotId', asyncMiddleware(adminController.getFreeTrialUserById));
router.post(
  '/updateSlotStatus',
  validateToken,
  asyncMiddleware(adminController.update_slot_status)
);
router.put('/updateDietPlanStatus/:id', asyncMiddleware(adminController.updateDietPlanStatus));
router.get('/getDietPlanStatus', asyncMiddleware(adminController.getDietPlanStatus));





module.exports = router;
