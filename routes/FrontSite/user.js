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

// App update popup rules (public, no login needed) — see fitHer Flows.
const appVersionController = require('../../controllers/appVersionController');
router.get('/app-version', asyncMiddleware(appVersionController.getAppVersion));
router.post('/app-version/report', validateToken, asyncMiddleware(appVersionController.reportAppVersion));

//AUTH APIS
// Rate limits (Oct 2026, helper/rateLimit.js): login 10 / 15 min per IP+email
// and 50 / 15 min per IP; reset-code routes 10 / 15 min per IP; sign-up
// 20 / hour per IP. Too many -> HTTP 429 { status: "0" }.
const { loginLimit, otpLimit, signupLimit } = require('../../helper/rateLimit');
router.post('/registration',signupLimit,asyncMiddleware(userController.registration));
router.post('/login',loginLimit,asyncMiddleware(userController.login));
// Logout reads the accessToken header itself (old apps send none).
router.post('/logout',asyncMiddleware(userController.logout));
router.post('/forget_password',otpLimit,asyncMiddleware(userController.forget_password));
// (Oct 2026 audit: /verify_email_check and /verify_email removed — their
// handlers don't exist, so every call crashed; the app doesn't use them.)
router.post('/change_password',validateToken,asyncMiddleware(userController.change_password));
router.post('/resend_otp',otpLimit,asyncMiddleware(userController.resend_otp));
router.post('/verify_otp',otpLimit,asyncMiddleware(userController.verify_otp));
router.post('/change_password_after_otp',otpLimit,asyncMiddleware(userController.change_password_after_otp));
router.post('/update_profile',validateToken,asyncMiddleware(userController.update_profile));
router.get('/get_profile',validateToken,asyncMiddleware(userController.get_profile));

//FRONT WEBSITE APIS
// Plan freeze (user-button flow). See docs/Freeze_Logic_Audit.md.
// Distinct from POST /admin/freeze which stays for admin override.
router.post('/plan/freeze', validateToken, asyncMiddleware(planFreezeController.freezePlan));
router.post('/plan/unfreeze', validateToken, asyncMiddleware(planFreezeController.unfreezePlan));
router.get('/plan/freeze-status', validateToken, asyncMiddleware(planFreezeController.freezeStatus));
router.post('/plan/cancel', validateToken, asyncMiddleware(planFreezeController.cancelPlan));

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
router.get('/health_screening/summary',validateToken,asyncMiddleware(userController.health_screening_summary));
// Fit Her accounts to pay into (upload slip screen).
router.get('/payment-accounts', validateToken, asyncMiddleware(require('../../controllers/Admin/paymentAccountController').listActive));
// Can she download her progress PDF yet? (start + a weekly check-in 7+ days later)
router.get('/progress-report/eligibility', validateToken, asyncMiddleware(require('../../controllers/FrontSite/progressReportController').eligibility));
// Plan paused because her payment wasn't confirmed: banner + proof.
router.post('/chat/notify', validateToken, asyncMiddleware(require('../../controllers/FrontSite/chatNotifyController').notify));
router.get('/payment-hold', validateToken, asyncMiddleware(require('../../controllers/Admin/paymentCheckController').myHold));
router.post('/payment-hold/proof', validateToken, asyncMiddleware(require('../../controllers/Admin/paymentCheckController').sendProof));
router.post('/health_screening/notify-dietitian',validateToken,asyncMiddleware(userController.notify_dietitian_screening));

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
// One weekly check-in (Oct 2026): helper/weeklyCheckin.js
router.get('/weekly-checkin/state', validateToken, asyncMiddleware(require('../../controllers/FrontSite/weeklyCheckinController').getState));
router.post('/weekly-checkin', validateToken, asyncMiddleware(require('../../controllers/FrontSite/weeklyCheckinController').save));
router.post('/weekly-checkin/measurements', validateToken, asyncMiddleware(require('../../controllers/FrontSite/weeklyCheckinController').logMeasurements));
router.get('/weekly-checkin/history', validateToken, asyncMiddleware(require('../../controllers/FrontSite/weeklyCheckinController').getHistory));
router.post('/profile/target_weight',validateToken,asyncMiddleware(userController.save_target_weight));

// PaidHero "Set goal →" chip (Diet tab home screen) — reads/writes the
// same User.mainGoal column GoalScreen sets at signup. Separate from
// target_weight above: mainGoal is the goal CATEGORY (Lose weight, etc.),
// targetWeightKg is a number.
router.post('/profile/main_goal',validateToken,asyncMiddleware(userController.save_main_goal));

// Progress Hub Phase E — minimal feature-flag toggle endpoint. Backed by
// a hard-coded allow-list in userController.set_feature_flag — only flags
// in that list can be toggled by clients (rest are admin-only).
router.post('/profile/feature_flag',validateToken,asyncMiddleware(userController.set_feature_flag));

//NOTIFICATION PREFERENCES APIS
router.get('/notification_preferences',validateToken,asyncMiddleware(userController.get_notification_preferences));
router.post('/notification_preferences',validateToken,asyncMiddleware(userController.save_notification_preferences));
router.post('/device-token',validateToken,asyncMiddleware(userController.update_device_token));
router.get('/notifications',validateToken,asyncMiddleware(userController.get_notifications));
router.post('/notifications/read',validateToken,asyncMiddleware(userController.mark_notifications_read));
router.post('/notifications/hide',validateToken,asyncMiddleware(userController.hide_notifications));

module.exports = router;
