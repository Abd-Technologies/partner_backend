// Shared setup and helpers used by more than one area (one Redis queue, one Stripe client, one mail transport).
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
require("dotenv").config({ path: 'backend.thefither.com/.env' });
const { getIO } = require("../../../socket");
console.log("📦 getIO function imported");
// correct path based on your structure
const {
  User,
  Plan,
  UserPlan,
  Service,
  Time,
  Category,
  UserReview,
  SubCategory,
  DietTime,
  ProgressImage,
  Diet,
  PlanImage,
  AssignedPlan,
  Contact,
  Wallet,
  PlanDietition,
  OtpData,
  Guest,
  Testimonial,
  Review,
  Announcement,
  Report,
  Slot,
  HealthTips,
  PdfDietsForUserNew,
  Price,
  PriceDurations,
  Countries,
  SlotDiet,
  TimeDietition,
  Appointment,
  FreeTrailUsersSlots,
  FreeTrailUsers,
  WeeklyCheckin,
  TrialJourney,
  sequelize: db,
} = require("../../../models");
const { currentWeekMonday } = require("../../../helper/dateUtils");
const Queue = require("bull");
const notificationQueue = new Queue("notificationQueue", {
  redis: { host: "127.0.0.1", port: 6379 },
});
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const ApiResponse = require("../../../helper/ApiResponse");
const { findFrozenActivePlan } = require("../../../helper/freezeGate");
const { normalizeSlotTime } = require("../../../helper/normalizeSlotTime");
// Single source of truth for "who gets notified about slot X" — see
// helper/crownjobfunction.js for why this must not be re-derived per call
// site (that duplication is what broke updateLink/updateTrainerJoin/
// update_slot_status in the first place).
const { getDeviceTokensForSlot } = require("../../../helper/crownjobfunction");
const bcrypt = require("bcryptjs");
const { issueToken, verifyAccess, revoke } = require("../../../helper/authToken");
const otpStore = require("../../../helper/otpStore");
const { Op } = require("sequelize");
const sequelize = require("sequelize");
const { response } = require("../../../routes/Admin/admin");
const sendNotification = require("../../../helper/notification");
const { extractSlipData } = require("../../../helper/visionOCR");
const { applyPlanApproval } = require("../../../helper/applyPlanApproval");
// OCR auto-approval thresholds (same as magic link flow)
const OCR_AUTO_APPROVE_MIN_CONFIDENCE = 0.75;
const OCR_AMOUNT_TOLERANCE_PKR        = 50;
const nodemailer = require("nodemailer");
const moment = require("moment-timezone");
const SLOT_DEFAULT_TZ = "Asia/Karachi";
const SLOT_WEEKDAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const PriceDuration = require("../../../models/PriceDuration");
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true, // use TLS
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});
// DirectPay "payment done" (the app calls this after DirectPay redirects to
// fither://payment/success). Oct 2026 security pass — no DirectPay check API
// yet, so:
//   • a client must have opened DirectPay for this plan in the last 3 hours
//     (PaymentAttempt "initiated", helper/purchaseLedger.directPayStarted);
//     each start can be used once;
//   • the plan starts at once but goes into the admin "Confirm payments"
//     list (helper/paymentVerify.js) as "DirectPay · ref <id>": the admin
//     checks the DirectPay merchant portal; not confirmed in 48 h → paused.
//   • Admin callers keep the old direct activation.
const DIRECTPAY_NOT_FOUND = "We couldn't find your payment. If you paid, send the receipt to support.";
const DIRECTPAY_WINDOW_MS = 3 * 60 * 60 * 1000;
const SAFE_USER = { exclude: ["password", "deviceToken"] };

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Slot.start / Slot.end accept canonical 24-hour UTC ("03:00") or legacy
// 12-hour with AM/PM ("03:00 PM"). Returns { hours, minutes, isUtc } or null.
function parseSlotPartsAdmin(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes, isUtc: true };
  }
  m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (m) {
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const isPm = m[3].toUpperCase() === "PM";
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes, isUtc: false };
  }
  return null;
}

// Convert raw stored slot HH:mm string to a UTC moment anchored to a
// reference UTC date that has the matching weekday name. Used so we can
// reliably do tz conversion.
function slotUtcMomentForDay(parts, dayName) {
  const wantedIdx = SLOT_WEEKDAY_NAMES.indexOf(dayName);
  if (wantedIdx < 0 || !parts) return null;
  const base = moment.utc().startOf("day");
  let candidate = base.clone();
  for (let i = 0; i < 7; i++) {
    if (candidate.day() === wantedIdx) break;
    candidate.add(1, "day");
  }
  if (parts.isUtc) {
    return candidate.hour(parts.hours).minute(parts.minutes);
  }
  // Legacy: treat HH:mm AM/PM as already-local in the default timezone.
  return moment
    .tz(
      `${candidate.format("YYYY-MM-DD")} ${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`,
      "YYYY-MM-DD HH:mm",
      SLOT_DEFAULT_TZ
    )
    .utc();
}

function convertToTimeStamp(timeString) {
  if (timeString == "Start Time") {
    return "Start Time";
  }
  if (timeString == "End Time") {
    return "End Time";
  }

  const today = new Date();
  const [hours, minutes] = timeString.split(/[: ]/); // Split into hours and minutes

  // Set the time
  today.setHours((hours % 12) + (timeString.includes("PM") ? 12 : 0));
  today.setMinutes(minutes || 0);
  today.setSeconds(0);
  today.setMilliseconds(0);

  // Convert to timestamp
  const timestamp = today.getTime();
  console.log("timeStapm -----------" + timestamp);
  return timestamp.toString();
}

async function freeze(req, res) {
  const { userId, freeze, freezingDays } = req.body;
  let plan = await UserPlan.findOne({ where: { userId: userId } });
  let user = await User.findOne({ where: { id: userId } });
  if (plan) {

    if (freeze === false) {
      if (user.freeze === true) {
        let updatedDate = new Date(user.updatedAt);
        const originalDate = new Date(plan.expireDate);
        const currentDate = new Date();


        const differenceInMs =
          Date.UTC(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate()
          ) -
          Date.UTC(
            updatedDate.getFullYear(),
            updatedDate.getMonth(),
            updatedDate.getDate()
          );

        const spendDays = Math.floor(differenceInMs / (1000 * 60 * 60 * 24));


        const utcDate = new Date(Date.UTC(
          originalDate.getFullYear(),
          originalDate.getMonth(),
          originalDate.getDate()
        ));
        // originalDate.setDate(originalDate.getDate() - parseInt(spendDays, 10));
        utcDate.setUTCDate(utcDate.getUTCDate() - parseInt((user.freezingDays - spendDays), 10));

        //const newDateStr = originalDate.toISOString();
        plan.expireDate = utcDate;



        user.freeze = false;
        user.freezingDays = null;
        plan.usedFreezeOption = false;
        user.usedFreezeOption = false;


        // Reset freezingDays
        await user.save();
        await plan.save();
        return res.json(ApiResponse("1", "User successfully unfrozen", {}));
      } else {
        return res.json(ApiResponse("0", "User is not currently frozen", {}));
      }
    }
    const originalDate = new Date(plan.expireDate);
    const utcDate = new Date(Date.UTC(
      originalDate.getFullYear(),
      originalDate.getMonth(),
      originalDate.getDate()
    ));
    utcDate.setUTCDate(utcDate.getUTCDate() + parseInt(freezingDays, 10));
    //originalDate.setDate(originalDate.getDate() + freezingDays);
    // Formatting the new date as an ISO string
    // const newDateStr = utcDate.toISOString();
    plan.expireDate = utcDate;
    await plan.save();

    user.freeze = freeze;
    user.freezingDays = freezingDays;
    await user.save();

    let response = ApiResponse("1", "User successfully freeze", {});
    return res.json(response);
  } else {
    let response = ApiResponse("0", "Plan does not exist", {});
    return res.json(response);
  }
}

/**
 * me — verify the bearer JWT and return the current user's profile.
 *
 * Used by external systems (CRM dashboard) to verify a session and
 * fetch role / userType without duplicating auth logic.
 *
 * Auth: validateToken middleware → req.user = { id, email } from JWT
 * Returns: { id, firstName, lastName, email, userType, status, timeZone, isAdmin, isSalesRep }
 */
async function me(req, res) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json(ApiResponse("0", "Invalid token payload", {}));
    }

    const user = await User.findOne({
      where: { id: userId },
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "userType",
        "status",
        "timeZone",
        "phone",
      ],
    });

    if (!user) {
      return res.status(404).json(ApiResponse("0", "User not found", {}));
    }

    const userType = user.userType || "";
    const isAdmin    = String(userType || "").trim().toLowerCase() === "admin";
    const isSalesRep = userType === "Customer_Support_Representative";

    // Only Admin and Customer_Support_Representative are allowed to use CRM-side APIs.
    // Other userTypes (User, Trainer, Dietition, Gynaecologist, etc.) get a flag of false
    // so the CRM frontend can show an "access denied" screen instead of a broken dashboard.
    const allowedInCrm = isAdmin || isSalesRep;

    return res.json(
      ApiResponse("1", "Current user", {
        id:         user.id,
        firstName:  user.firstName,
        lastName:   user.lastName,
        email:      user.email,
        phone:      user.phone,
        userType:   user.userType,
        status:     user.status,
        timeZone:   user.timeZone || "Asia/Karachi",
        isAdmin,
        isSalesRep,
        allowedInCrm,
      })
    );
  } catch (err) {
    console.error("Error in /admin/me:", err);
    return res.status(500).json(ApiResponse("0", "Internal server error", { error: err.message }));
  }
}

module.exports = {
  getIO,
  User,
  Plan,
  UserPlan,
  Service,
  Time,
  Category,
  UserReview,
  SubCategory,
  DietTime,
  ProgressImage,
  Diet,
  PlanImage,
  AssignedPlan,
  Contact,
  Wallet,
  PlanDietition,
  OtpData,
  Guest,
  Testimonial,
  Review,
  Announcement,
  Report,
  Slot,
  HealthTips,
  PdfDietsForUserNew,
  Price,
  PriceDurations,
  Countries,
  SlotDiet,
  TimeDietition,
  Appointment,
  FreeTrailUsersSlots,
  FreeTrailUsers,
  WeeklyCheckin,
  TrialJourney,
  db,
  currentWeekMonday,
  Queue,
  notificationQueue,
  stripe,
  ApiResponse,
  findFrozenActivePlan,
  normalizeSlotTime,
  getDeviceTokensForSlot,
  bcrypt,
  issueToken,
  verifyAccess,
  revoke,
  otpStore,
  Op,
  sequelize,
  response,
  sendNotification,
  extractSlipData,
  applyPlanApproval,
  OCR_AUTO_APPROVE_MIN_CONFIDENCE,
  OCR_AMOUNT_TOLERANCE_PKR,
  nodemailer,
  moment,
  SLOT_DEFAULT_TZ,
  SLOT_WEEKDAY_NAMES,
  PriceDuration,
  transporter,
  DIRECTPAY_NOT_FOUND,
  DIRECTPAY_WINDOW_MS,
  SAFE_USER,
  generateOTP,
  parseSlotPartsAdmin,
  slotUtcMomentForDay,
  convertToTimeStamp,
  freeze,
  me,
};
