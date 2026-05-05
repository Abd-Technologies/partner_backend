const express = require('express');
const router = express();
const multer = require('multer');
const path = require('path');
const {validateToken} = require("../../middlewares/AuthorizationMW")
const {validateAdmin} = require("../../middlewares/ValidateAdmin");
const asyncMiddleware = require('../../middlewares/async');
const userController = require('../../controllers/FrontSite/userController');
const paymentController = require('../../controllers/FrontSite/paymentController');
const planFreezeController = require('../../controllers/FrontSite/planFreezeController');

//AUTH APIS
router.post('/registration',asyncMiddleware(userController.registration));
router.post('/login',asyncMiddleware(userController.login));
router.post('/logout',asyncMiddleware(userController.logout));
router.post('/forget_password',asyncMiddleware(userController.forget_password));
router.post('/verify_email_check',asyncMiddleware(userController.verify_email_check));
router.post('/change_password',validateToken,asyncMiddleware(userController.change_password));
router.post('/resend_otp',asyncMiddleware(userController.resend_otp));
router.post('/verify_otp',asyncMiddleware(userController.verify_otp));
router.post('/verify_email',asyncMiddleware(userController.verify_email));
router.post('/change_password_after_otp',asyncMiddleware(userController.change_password_after_otp));
router.post('/update_profile',validateToken,asyncMiddleware(userController.update_profile));
router.get('/get_profile',validateToken,asyncMiddleware(userController.get_profile));

//FRONT WEBSITE APIS
// Plan freeze (user-button flow). See docs/Freeze_Logic_Audit.md.
// Distinct from POST /admin/freeze which stays for admin override.
router.post('/plan/freeze', validateToken, asyncMiddleware(planFreezeController.freezePlan));
router.post('/plan/unfreeze', validateToken, asyncMiddleware(planFreezeController.unfreezePlan));
router.get('/plan/freeze-status', validateToken, asyncMiddleware(planFreezeController.freezeStatus));

router.get('/get_plan_details/:planId',validateToken,asyncMiddleware(userController.get_plan_details));
router.get('/get_user_plans',validateToken,asyncMiddleware(userController.get_user_plans));
router.get('/all_plans',validateToken,asyncMiddleware(userController.all_plans));
router.get('/workout',validateToken,asyncMiddleware(userController.workout));
router.post('/stripe_payment',validateToken,asyncMiddleware(paymentController.stripe_payment));

router.get('/home',validateToken,asyncMiddleware(userController.home));
router.get('/all_services',validateToken,asyncMiddleware(userController.all_services));
router.post('/send_message',validateToken,asyncMiddleware(userController.send_message));

//CYCLE DATA APIS
router.post('/cycle_data',validateToken,asyncMiddleware(userController.save_cycle_data));
router.get('/cycle_data',validateToken,asyncMiddleware(userController.get_cycle_data));

//PCOS SCREENING (legacy — delegates to generic)
router.post('/pcos_screening',validateToken,asyncMiddleware(userController.save_pcos_screening));
router.get('/pcos_screening',validateToken,asyncMiddleware(userController.get_pcos_screening));

//GENERIC HEALTH SCREENING (PCOS, Thyroid, Menopause, Postpartum, Endometriosis)
router.post('/health_screening',validateToken,asyncMiddleware(userController.save_health_screening));
router.get('/health_screening',validateToken,asyncMiddleware(userController.get_health_screening));

//DAILY CHECK-IN APIS
router.post('/daily_checkin',validateToken,asyncMiddleware(userController.save_daily_checkin));
router.get('/daily_checkin',validateToken,asyncMiddleware(userController.get_daily_checkin));
router.get('/daily_checkins/week',validateToken,asyncMiddleware(userController.get_daily_checkins_week));
router.get('/daily_checkins/recent',validateToken,asyncMiddleware(userController.get_daily_checkins_recent));

//WEEKLY CHECK-IN APIS
router.post('/weekly_checkin',validateToken,asyncMiddleware(userController.save_weekly_checkin));
router.get('/weekly_checkins/recent',validateToken,asyncMiddleware(userController.get_weekly_checkins_recent));

//PaidHomeV2 — weight tracking (Phase B2.7)
router.post('/weekly_checkin/weight',validateToken,asyncMiddleware(userController.save_weight_log));
router.post('/profile/target_weight',validateToken,asyncMiddleware(userController.save_target_weight));

// Progress Hub Phase E — minimal feature-flag toggle endpoint. Backed by
// a hard-coded allow-list in userController.set_feature_flag — only flags
// in that list can be toggled by clients (rest are admin-only).
router.post('/profile/feature_flag',validateToken,asyncMiddleware(userController.set_feature_flag));

//NOTIFICATION PREFERENCES APIS
router.get('/notification_preferences',validateToken,asyncMiddleware(userController.get_notification_preferences));
router.post('/notification_preferences',validateToken,asyncMiddleware(userController.save_notification_preferences));

module.exports = router;