require("dotenv").config({ path: 'backend.thefither.com/.env' });
const { getIO } = require("../../socket");
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
} = require("../../models");
const { currentWeekMonday } = require("../../helper/dateUtils");
const Queue = require("bull");
const notificationQueue = new Queue("notificationQueue", {
  redis: { host: "127.0.0.1", port: 6379 },
});
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const ApiResponse = require("../../helper/ApiResponse");
const { findFrozenActivePlan } = require("../../helper/freezeGate");
const { normalizeSlotTime } = require("../../helper/normalizeSlotTime");
// Single source of truth for "who gets notified about slot X" — see
// helper/crownjobfunction.js for why this must not be re-derived per call
// site (that duplication is what broke updateLink/updateTrainerJoin/
// update_slot_status in the first place).
const { getDeviceTokensForSlot } = require("../../helper/crownjobfunction");

const bcrypt = require("bcryptjs");
const { sign } = require("jsonwebtoken");
const { Op } = require("sequelize");
const sequelize = require("sequelize");
const { response } = require("../../routes/Admin/admin");
const sendNotification = require("../../helper/notification");
const { extractSlipData } = require("../../helper/visionOCR");
const { applyPlanApproval } = require("../../helper/applyPlanApproval");

// OCR auto-approval thresholds (same as magic link flow)
const OCR_AUTO_APPROVE_MIN_CONFIDENCE = 0.75;
const OCR_AMOUNT_TOLERANCE_PKR        = 50;
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
const nodemailer = require("nodemailer");
const moment = require("moment-timezone");
const SLOT_DEFAULT_TZ = "Asia/Karachi";
const SLOT_WEEKDAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

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

// Group an array of Slot rows by the user-local weekday after timezone
// conversion, returning the same shape as the legacy controller emitted.
// `id` is preserved as the original Time.id when all slots in the bucket
// shared one (typical case) — otherwise falls back to the weekday index.
function groupSlotsByLocalWeekday(slots, userTz) {
  const buckets = {};
  for (const slot of slots) {
    if (!slot.Time) continue;
    const local = localizeSlotForUser(slot, userTz);
    const key = local.weekday || slot.Time.day;
    if (!buckets[key]) {
      buckets[key] = {
        id: slot.Time.id,
        day: key,
        slots: [],
        _orderIdx: SLOT_WEEKDAY_NAMES.indexOf(key),
      };
    }
    buckets[key].slots.push({
      id: slot.id,
      start: local.start,
      end: local.end,
      isTrainerJoined: slot.isTrainerJoined,
      joinedUserUID: slot.joinedUserUID,
      type: slot.type,
      level: slot.level,
      status: slot.status,
      description: slot.description,
      trainerLink: slot.trainerLink,
      trainer: slot.User,
    });
  }
  return Object.values(buckets)
    .sort((a, b) => a._orderIdx - b._orderIdx)
    .map(({ _orderIdx, ...rest }) => rest);
}

// Build a slot's display payload converted to the user's timezone.
// Returns { start, end, weekday } where start/end are "hh:mm A" strings
// and weekday is the user-local weekday name (may differ from Time.day if
// the timezone shift crosses midnight).
function localizeSlotForUser(slot, userTz) {
  const tz = userTz || SLOT_DEFAULT_TZ;
  const dayName = slot.Time && slot.Time.day ? slot.Time.day : null;
  const startParts = parseSlotPartsAdmin(slot.start);
  const endParts = parseSlotPartsAdmin(slot.end);

  let startStr = slot.start;
  let endStr = slot.end;
  let weekday = dayName;

  if (dayName && startParts) {
    const startUtc = slotUtcMomentForDay(startParts, dayName);
    if (startUtc) {
      const startLocal = startUtc.clone().tz(tz);
      startStr = startLocal.format("hh:mm A");
      weekday = startLocal.format("dddd");
      if (endParts) {
        // Build end the same way as start — going through
        // slotUtcMomentForDay so that local-AM/PM end values are
        // interpreted in PKT (not as raw UTC hours, which was the
        // pre-fix bug that produced "03:00 AM → 08:50 AM" outputs).
        let endUtc = slotUtcMomentForDay(endParts, dayName);
        if (endUtc && endUtc.isBefore(startUtc)) endUtc.add(1, "day");
        if (endUtc) endStr = endUtc.clone().tz(tz).format("hh:mm A");
      }
    }
  }
  return { start: startStr, end: endStr, weekday };
}
const PriceDuration = require("../../models/PriceDuration");
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true, // use TLS
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});
console.log("JWT_ACCESS_SECRET:", process.env.JWT_ACCESS_SECRET);

async function sendOtp(req, res) {
  const { email } = req.body;
  try {
    let user = await User.findOne({ where: { email: email } });
    if (user) {
      let OTP = generateOTP();
      let otpData = await OtpData.findOne({ where: { UserId: user.id } });
      if (otpData) {
        otpData.otp = OTP;
        await otpData.save();
      } else {
        let newData = new OtpData();
        newData.otp = OTP;
        newData.UserId = user.id;
        await newData.save();
      }
      transporter.sendMail(
        {
          from: process.env.EMAIL_USERNAME, // sender address
          to: email, // list of receivers
          subject: `Your OTP for The fither is ${OTP}`, // Subject line
          text: `Your OTP for The fither is ${OTP}`, // plain text body
        },
        function (error, info) {
          console.log(error);
          console.log(info);
        }
      );
      const response = ApiResponse("1", "OTP send successfully", {});
      return res.json(response);
    }
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}
async function verifyOtp(req, res) {
  let { otp } = req.body;
  let otpData = await OtpData.findOne({ where: { otp: otp } });
  if (otpData) {
    let userData = await User.findOne({
      where: { id: otpData.UserId },
      attributes: ["id", "email"],
    });
    let response = ApiResponse("1", "Opt verified", { userData });
    return res.json(response);
  } else {
    let ressponse = ApiResponse("0", "Invalid OTP", {});
    return res.json(ressponse);
  }
}
async function updatePassword(req, res) {
  const { password, userId } = req.body;
  let userData = await User.findOne({ where: { id: userId } });
  if (userData) {
    var salt = await bcrypt.genSaltSync(10);
    userData.password = await bcrypt.hashSync(password, salt);
    userData
      .save()
      .then((dat) => {
        let response = ApiResponse("1", "Password updated successfully", {});
        return res.json(response);
      })
      .catch((error) => {
        let response = ApiResponse("0", error.message, {});
        return res.json(response);
      });
  }
}

async function login_check(req, res) {
  const token = req.header("accessToken");
  const validToken = verify(token, process.env.JWT_ACCESS_SECRET);
  if (validToken) {
    const check = await BlackList.findOne({ where: { accessToken: token } });
    if (check) {
      const response = ApiResponse("0", "Session expire!", {});
      return res.json(response);
    } else {
      const response = ApiResponse("1", "Login Already!", {});
      return res.json(response);
    }
  } else {
    const response = ApiResponse("0", "Session expire!", {});
    return res.json(response);
  }
}

async function registration(req, res) {
  const { firstName, lastName, email, phone, password } = req.body;
  const checkEmail = await User.findOne({ where: { email: email } });
  const checkPhone = await User.findOne({ where: { phone: phone } });
  if (checkEmail) {
    const response = ApiResponse("0", "Email already exist", {});
    return res.json(response);
  } else if (checkPhone) {
    const response = ApiResponse("0", "Phone No. already exist", {});
    return res.json(response);
  } else {
    var salt = await bcrypt.genSaltSync(10);

    const user = new User();
    user.firstName = firstName;
    user.lastName = lastName;
    user.email = email;
    user.phone = phone;

    user.userType = "Admin";
    user.status = 1;
    user.password = await bcrypt.hashSync(password, salt);
    user
      .save()
      .then(async (dat) => {
        const accessToken = sign(
          { email: user.email, id: user.id },
          process.env.JWT_ACCESS_SECRET
        );
        let data = {
          id: dat.id,
          firstName: dat.firstName,
          lastName: dat.lastName,
          phone: dat.phone,
          email: dat.email,
          accessToken: accessToken,
        };

        const response = ApiResponse(
          "1",
          "Admin Registered successfully!",
          data
        );
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", error.message, {});
        return res.json(response);
      });
  }
}
async function login(req, res) {

  const { email, password, deviceToken, userType, timeZone } = req.body;
  const user = await User.findOne({
    where: { email: email, userType: userType },
  });
  let adminData = await User.findOne({ where: { userType: "Admin" } });
  //return res.json(process.env.JWT_ACCESS_SECRET);
  if (user) {
    // if (user.status == 0) {
    //   const response = ApiResponse("0", "Sorry! Admin blocked!", {});
    //   return res.json(response);
    // }
    // if (user.userType === "User") {
    //   const response = ApiResponse("0", "You are not admin!", {});
    //   return res.json(response);
    // }


    //   if (user.deviceToken !== deviceToken && user.deviceToken !== null && user.userType !== "admin") {
    //     const response = ApiResponse("0", "You are logged in on another device. Please log out from other devices and try again.", //{});
    //     return res.json(response);
    //  }





    const validPassword = await bcrypt.compare(password, user.password);
    if (validPassword) {
      const accessToken = sign(
        { email: user.email, id: user.id },
        process.env.JWT_ACCESS_SECRET
      );
      user.deviceToken = deviceToken;
      user.timeZone = timeZone;
      await user.save();
      let data = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone || '',
        adminId: adminData ? adminData?.id : 0,
        email: user.email,
        status: user.status,
        accessToken: accessToken,
        userType: user.userType,
        bmiResult: user.bmiResult,
        age: user.age,
        height: user.height,
        weight: user.weight,
        mainGoal: user.mainGoal || '',
        healthConditions: user.healthConditions || '',
        useNewPaidHome: user.useNewPaidHome ?? false,
        useNewUnpaidHome: user.useNewUnpaidHome ?? false,
        // Phase F.3 — surfaced so Flutter can cache the user's IANA
        // zone for "today's meals" math instead of a device-local
        // shortcut. Backend remains source of truth; the Flutter
        // TimezoneSyncService PATCHes back when the device drifts.
        timeZone: user.timeZone || 'Asia/Karachi',
      };
      const response = ApiResponse("1", "Login Successfully!", data);
      return res.json(response);
    } else {
      const response = ApiResponse("0", "Incorrect Username or Password!", {});
      return res.json(response);
    }
  } else {
    const response = ApiResponse("0", "User not exist", {});
    return res.json(response);
  }
}


async function socialLogin(req, res) {
  const { email, deviceToken, userType, timeZone } = req.body;

  try {
    const user = await User.findOne({
      where: { email: email, userType: userType },
    }); const adminData = await User.findOne({ where: { userType: "Admin" } });

    if (user) {
      const accessToken = sign(
        { email: user.email, id: user.id },
        process.env.JWT_ACCESS_SECRET
      );

      // Update deviceToken and timeZone
      user.deviceToken = deviceToken;
      user.timeZone = timeZone;
      await user.save();

      const data = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone || '',
        adminId: adminData ? adminData.id : 0,
        email: user.email,
        status: user.status,
        accessToken: accessToken,
        userType: user.userType,
        bmiResult: user.bmiResult,
        age: user.age,
        height: user.height,
        weight: user.weight,
        mainGoal: user.mainGoal || '',
        healthConditions: user.healthConditions || '',
        useNewPaidHome: user.useNewPaidHome ?? false,
        useNewUnpaidHome: user.useNewUnpaidHome ?? false,
        // Phase F.3 — see login() above for rationale.
        timeZone: user.timeZone || 'Asia/Karachi',
      };

      const response = ApiResponse("1", "Login Successfully!", data);
      return res.json(response);
    } else {
      // User does not exist — return status "2"
      const response = ApiResponse("2", "User not found", {});
      return res.json(response);
    }
  } catch (err) {
    console.error("Social Login Error:", err);
    const response = ApiResponse("0", "Something went wrong!", {});
    return res.status(200).json(response);
  }
}
async function admin_get_profile(req, res) {
  const user = await User.findOne({
    where: [{ userType: "Admin" }, { status: true }, { id: req.user.id }],
  });
  const response = ApiResponse("1", "Profile", user);
  return res.json(response);
}
async function admin_edit_profile(req, res) {
  const { firstName, lastName, email, phone } = req.body;
  const user = await User.findOne({ where: { id: req.user.id } });
  user.firstName = firstName;
  user.lastName = lastName;
  user.email = email;
  user.phone = phone;
  user
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Profile Updated successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}
async function updateUser(req, res) {
  const {
    firstName,
    lastName,
    email,
    phone,
    userId,
    password,
    freeze,
    UserPlanId,
    days,
  } = req.body;

  try {
    const user = await User.findOne({ where: { id: userId } });
    if (!user) {
      return res.status(404).json(ApiResponse("0", "User not found", {}));
    }

    user.firstName = firstName;
    user.lastName = lastName;
    user.freeze = freeze;
    user.email = email;
    user.phone = phone;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }

    if (!freeze) {
      let plan = await UserPlan.findOne({ where: { userId: userId } });
      if (plan) {
        if (plan.expireDate && user?.freeingDays) {
          const originalDate = new Date(plan.expireDate);
          const freeingDays = parseInt(user.freeingDays, 10);

          if (!isNaN(freeingDays)) {
            originalDate.setDate(originalDate.getDate() - freeingDays);

            if (!isNaN(originalDate.getTime())) {
              plan.expireDate = originalDate.toISOString();
              await plan.save();
            } else {
              console.error("Invalid date after subtraction");
            }
          } else {
            console.error("Invalid freeingDays value");
          }
        } else {
          console.error("Missing expireDate or freeingDays");
        }
      } else {
        console.error("No plan found for user");
      }
    }

    let userPlan = await UserPlan.findOne({ where: { id: UserPlanId } });
    if (userPlan) {
      const expireDate = new Date(userPlan.expireDate);
      expireDate.setDate(expireDate.getDate() + parseInt(days, 10));
      userPlan.expireDate = expireDate.toISOString();
      await userPlan.save();
    }

    await user.save();
    const response = ApiResponse("1", "User Updated successfully!", {});
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.status(500).json(response);
  }
}

async function dashboard(req, res) {
  const users = await User.count();
  const plans = await Plan.count();
  const usersplans = await UserPlan.count();
  const categories = await Category.count();
  const services = await Service.count();
  const totalAmount = await Wallet.findAll({
    attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "totalAmount"]],
  });

  const data = {
    users: users,
    usersplans: usersplans,
    plans: plans,
    services: services,
    categories: categories,
    totalAmount: totalAmount[0].dataValues.totalAmount,
  };
  const response = ApiResponse("1", "Dashboard Data", data);
  return res.json(response);
}
async function add_plan(req, res) {
  const {
    title,
    shortDescription,
    longDescription,
    CategoryId,
    subCategoryId,
    countriesList,
    dietitianId,
  } = req.body;

  const exist_plan = await Plan.findOne({
    where: [{ title: title }, { status: true }],
  });

  if (exist_plan) {
    const response = ApiResponse("0", "Already exists", {});
    return res.json(response);
  } else {
    const plan = new Plan();
    plan.title = title;
    plan.shortDescription = shortDescription;
    plan.longDescription = longDescription;
    plan.status = true;
    plan.CategoryId = CategoryId;
    plan.SubCategoryId = subCategoryId;
    plan.dietitianId = dietitianId;

    try {
      let checkCategory = await Category.findOne({
        where: { id: CategoryId },
      });

      const dat = await plan.save();

      console.log("value-----------------" + countriesList);
      //  if (checkCategory.name === "Diet" || checkCategory.name === "Both") {
      for (let cont = 0; cont < countriesList.length; cont++) {
        console.log(
          "value-----------------" + countriesList[cont].durationList[0].amount
        );

        for (
          let dur = 0;
          dur < countriesList[cont].durationList.length;
          dur++
        ) {
          console.log("value-----------------333" + dur);

          let price = new Price();
          console.log("value-----------------saving");

          price.planId = dat.id;
          price.priceAmount = countriesList[cont].durationList[dur].amount; // Assuming amount is a property of durationList objects
          price.countryId = countriesList[cont].id; // Assuming country id is a property of countriesList objects
          price.durationId = countriesList[cont].durationList[dur].id; // Assuming id is a property of durationList objects

          await price.save(); // Save the price
        }
      }

      //  }

      const response = ApiResponse("1", "Plan added successfully!", {});
      return res.json(response);
    } catch (error) {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    }
  }
}

async function add_slots(req, res) {
  try {
    const { times } = req.body;

    // Check if times data is provided
    if (!times || times.length === 0) {
      const response = ApiResponse("0", "No times data provided.", {});
      return res.json(response);
    }

    // Loop through each day object in the times array
    for (const dd of times) {
      // Create a new Time instance
      const newTime = new Time();
      newTime.day = dd.day;
      newTime.status = 1;

      // Save the Time instance and wait for the ID to be generated
      await newTime.save();

      // Loop through each slot in the current day's slots array
      for (const timeSlot of dd.slots) {
        // Normalize incoming start/end into canonical "hh:mm A" PKT.
        // Legacy admin clients sometimes send ms timestamps or 24-hour
        // UTC strings; normalizing here keeps the DB single-format.
        const normalizedStart = normalizeSlotTime(timeSlot.start);
        const normalizedEnd = normalizeSlotTime(timeSlot.end);

        const newSlot = new Slot();
        newSlot.start = normalizedStart ?? timeSlot.start;
        newSlot.end = normalizedEnd ?? timeSlot.end;
        newSlot.TimeId = newTime.id;
        // Same optional workout-details fields as update_slots below --
        // add_slots doesn't assign a trainer yet, but nothing stops the
        // admin from typing the class type/level/description in while
        // building the initial grid, same as update_slots does.
        if (timeSlot.type != null) newSlot.type = timeSlot.type;
        if (timeSlot.level != null) newSlot.level = timeSlot.level;
        if (timeSlot.description != null) {
          newSlot.description = timeSlot.description;
        }
        await newSlot.save();
      }
    }

    // Return success response if all slots were added successfully
    const response = ApiResponse("1", "Slots added successfully!", {});
    return res.json(response);
  } catch (error) {
    // Catch any errors and return an error response
    console.error("Error adding slots:", error);
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
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

async function update_slots(req, res) {

  try {
    const { times } = req.body;

    if (!times || !Array.isArray(times) || times.length === 0) {
      return res.json(ApiResponse("0", "No times data provided.", {}));
    }

    for (const dd of times) {
      let timeEntry = await Time.findOne({ where: { day: dd.day } });

      if (!timeEntry) {
        // Create new Time instance
        timeEntry = new Time();
        timeEntry.day = dd.day;
        timeEntry.status = dd.status || 1;
        await timeEntry.save();
      } else {
        // Update existing Time
        timeEntry.status = dd.status || 1;
        await timeEntry.save();
      }

      // Handle slots
      if (Array.isArray(dd.slots) && dd.slots.length > 0) {
        for (const slot of dd.slots) {
          // Normalize once per slot — input can be ms timestamp / UTC HH:mm
          // / AM/PM. Output is always canonical "hh:mm A" PKT.
          const normalizedStart = normalizeSlotTime(slot.start);
          const normalizedEnd = normalizeSlotTime(slot.end);

          if (slot.id) {
            const existingSlot = await Slot.findOne({
              where: { id: slot.id, TimeId: timeEntry.id }
            });

            if (existingSlot) {
              existingSlot.start = normalizedStart ?? slot.start;
              existingSlot.end = normalizedEnd ?? slot.end;
              existingSlot.trainerId = slot.trainerId;
              existingSlot.status = "Upcoming Class";
              // Workout details (type/level/description) used to only be
              // settable later, one slot at a time, via update_slot_trainer
              // -- meaning the trainer had to fill them in themselves after
              // the admin assigned them. Letting the admin send these here
              // too means the slot can be fully set up in one step. Each
              // field is only touched when the admin actually sent a real
              // value -- checked with != so both a missing key AND an
              // explicit null (what the Flutter form sends for a field
              // left blank) are skipped, not just a missing key. Otherwise
              // an admin who leaves these blank while just updating the
              // trainer would silently wipe out a value a trainer already
              // set the old way.
              if (slot.type != null) existingSlot.type = slot.type;
              if (slot.level != null) existingSlot.level = slot.level;
              if (slot.description != null) {
                existingSlot.description = slot.description;
              }
              await existingSlot.save();
              continue;
            }
          }

          const newSlot = new Slot();
          newSlot.start = normalizedStart ?? slot.start;
          newSlot.end = normalizedEnd ?? slot.end;
          newSlot.trainerId = slot.trainerId;
          newSlot.TimeId = timeEntry.id;
          newSlot.status = "Upcoming Class";
          if (slot.type != null) newSlot.type = slot.type;
          if (slot.level != null) newSlot.level = slot.level;
          if (slot.description != null) newSlot.description = slot.description;
          await newSlot.save();
        }
      }
    }

    return res.json(ApiResponse("1", "Slots updated successfully!", {}));
  } catch (error) {
    // No transaction was opened in this function — calling `t.rollback()`
    // here previously crashed the catch handler with "Cannot read
    // properties of undefined". If we ever introduce a transaction, the
    // rollback goes inside that transaction's scope, not here.
    console.error("Error updating slots:", error);
    return res.json(ApiResponse("0", error.message, {}));
  }
}

async function update_slot_trainer(req, res) {
  try {
    const { type, level, description, slotId } = req.body;

    // Find the slot by ID and wait for the result
    const slot = await Slot.findOne({ where: { id: slotId } });

    if (slot) {
      // Update the trainerId for the slot
      slot.type = type;
      slot.level = level;
      slot.description = description;
      await slot.save();

      const response = ApiResponse("1", "Slot updated successfully!", {});
      return res.json(response);
    } else {
      const response = ApiResponse(
        "0",
        "No slot available with the given ID.",
        {}
      );
      return res.json(response);
    }
  } catch (error) {
    // Catch any errors and return an error response
    console.error("Error updating slot:", error);
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}


async function update_slot_status(req, res) {
  try {
    const { status, slotId } = req.body;

    if (!slotId || !status) {
      return res.json(ApiResponse("0", "Missing slotId or status", {}));
    }

    const slot = await Slot.findOne({ where: { id: slotId } });

    if (!slot) {
      return res.json(ApiResponse("0", "No slot available with the given ID.", {}));
    }

    // Update slot status. Capture the actor (req.user.id from validateToken)
    // and the change time so the audit log can distinguish manual ends
    // from auto-end cron flips. Auto-end intentionally writes NULL into
    // completed_by — that's the "trainer forgot" signal.
    const now = new Date();
    slot.status = status;
    if (req.user && req.user.id) slot.completed_by = req.user.id;
    slot.status_changed_at = now;
    await slot.save();

    // Log operational timing metrics (trainer punctuality & class duration)
    try {
      if (status === "In Progress") {
        console.log(
          `[class-analytics] TRAINER_STARTED_CLASS: slotId=${slot.id} trainerId=${slot.trainerId} scheduledStart="${slot.start}" actualStart="${now.toISOString()}" actor=${req.user ? req.user.id : "unknown"}`
        );
      } else if (status === "Completed") {
        console.log(
          `[class-analytics] TRAINER_ENDED_CLASS: slotId=${slot.id} trainerId=${slot.trainerId} scheduledEnd="${slot.end}" actualEnd="${now.toISOString()}" endedBy=${slot.completed_by ? `trainer_${slot.completed_by}` : "auto_end_cron"}`
        );
      }
    } catch (_) {}

    // Fetch trainer details
    const trainer = await User.findOne({
      attributes: ["id", "firstName", "lastName", "email"],
      where: { id: slot.trainerId },
    });

    // Create notification message
    let title = "";
    let body = "";

    if (status === "Cancelled") {
      title = "Class Cancelled";
      body = "Sorry, your upcoming class has been cancelled.";
    } else if (status === "In Progress") {
      title = "Sweat Now, Selfies Later";
      body = "Join the session now.";
    } else {
      title = "Class Link Added";
      body = "Join the session now.";
    }

    const data = {
      upcomingSlot: JSON.stringify(slot),
      trainer: JSON.stringify(trainer),
    };

    // Emit socket event

    const io = getIO();
    console.log("⏳ Emitting slotUpdate...");
    io.emit("slotUpdate", data);
    console.log("✅ slotUpdate emitted successfully");

    // title/body were built above but never sent anywhere — this function
    // emitted the socket event and stopped, so closed-app users never
    // heard about cancellations or status changes at all. TYPE_BY_TITLE
    // already covers all three titles used above ("Class Cancelled",
    // "Sweat Now, Selfies Later", "Class Link Added"), so no explicit
    // data.type is needed here either.
    const deviceTokens = await getDeviceTokensForSlot(slot);
    await notificationQueue.add({
      title,
      body,
      data,
      deviceTokens,
    });

    return res.json(ApiResponse("1", "Slot updated successfully!", {}));
  } catch (error) {
    console.error("❌ Error in update_slot_status:", error);
    return res.json(ApiResponse("0", "Internal Server Error", {}));
  }
}




// API for getting all times with associated slots
async function getAllTimesWithSlots(req, res) {
  try {
    // Find all Time entries with associated Slots
    const times = await Time.findAll({
      include: [
        {
          model: Slot,
          // type/level/description added so the Add Trainer Slots screen
          // can show an already-set workout detail instead of blanking it
          // out on every load.
          attributes: [
            "id",
            "start",
            "end",
            "trainerId",
            "TimeId",
            "type",
            "level",
            "description",
          ],
        },
      ],
      attributes: ["id", "day", "status"], // Specify time fields you want to retrieve
    });

    const response = ApiResponse(
      "1",
      "Times with slots fetched successfully!",
      { times: times }
    );
    return res.json(response);
  } catch (error) {
    console.error("Error fetching times with slots:", error);
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function update_plan(req, res) {
  const {
    id,
    title,
    shortDescription,
    longDescription,
    price,
    CategoryId,
    countriesList,
    duration,
  } = req.body;

  try {
    const exist_plan = await Plan.findOne({ where: { id: id } });

    if (!exist_plan) {
      const response = ApiResponse("0", "Plan not found", {});
      return res.json(response);
    }

    exist_plan.title = title || exist_plan.title;
    exist_plan.shortDescription =
      shortDescription || exist_plan.shortDescription;
    exist_plan.longDescription = longDescription || exist_plan.longDescription;
    exist_plan.price = price || exist_plan.price;
    exist_plan.duration = duration || exist_plan.duration;
    exist_plan.CategoryId = CategoryId || exist_plan.CategoryId;
    exist_plan.status = exist_plan.status;

    await exist_plan.save();
    // await Price.destroy({ where: { planId: id } });
    for (let cont = 0; cont < countriesList.length; cont++) {
      for (let dur = 0; dur < countriesList[cont].durationList.length; dur++) {
        const { amount, id: durationId } = countriesList[cont].durationList[dur];
        const countryId = countriesList[cont].id;

        // Check if the price entry already exists
        const existingPrice = await Price.findOne({
          where: { planId: id, countryId, durationId },
        });

        if (existingPrice) {
          // Update existing price
          existingPrice.priceAmount = amount;
          await existingPrice.save();
        } else {
          // Create new price entry
          let price = new Price();
          price.planId = id;
          price.priceAmount = amount;
          price.countryId = countryId;
          price.durationId = durationId;

          await price.save();
        }
      }
    }
    // Add new prices
    // for (let cont = 0; cont < countriesList.length; cont++) {
    //   for (let dur = 0; dur < countriesList[cont].durationList.length; dur++) {
    //     let price = new Price();
    //     price.planId = id;
    //     price.priceAmount = countriesList[cont].durationList[dur].amount;
    //     price.countryId = countriesList[cont].id;
    //     price.durationId = countriesList[cont].durationList[dur].id;

    //     await price.save(); // Save the price
    //   }
    // }
    // let checkCategory = await Category.findOne({ where: { id: CategoryId } });

    // if (checkCategory.name == "Diet") {
    //   const response = ApiResponse("1", "Plan updated successfully!", {});
    //   return res.json(response);
    // } else {
    //   if (times) {
    //     // Delete existing times and slots
    //     await Time.destroy({ where: { PlanId: id } });

    //     for (const dd of times) {
    //       const newTime = new Time();
    //       newTime.day = dd.day;
    //       newTime.status = 1;
    //       newTime.PlanId = id;
    //       await newTime.save();

    //       for (const timeSlot of dd.slots) {
    //         const newSlot = new Slot();
    //         newSlot.start = timeSlot.start;
    //         newSlot.end = timeSlot.end;
    //         newSlot.TimeId = newTime.id;
    //         await newSlot.save();
    //       }
    //     }
    //  }

    const response = ApiResponse("1", "Plan updated successfully!", {});
    return res.json(response);
    //  }
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_plans(req, res) {
  try {
    const { code } = req.params;
    let prices = await Price.findAll({
      include: [
        {
          model: PriceDurations,
          as: "priceDuration", // Use an alias if defined in the association
          // Replace with actual fields in the Duration table
        },
        {
          where: { name: code },
          model: Countries,
          attributes: ["id", "name", "code", "currency"],
          as: "country", // Use an alias if defined in the association
          // Replace with actual fields in the Country table
        },
        {
          model: Plan,
          where: {
            title: {
              [Op.ne]: "Free Trial", // Exclude "Free Trial" plans
            },
          },
          //   attributes: ["id", "title","shortDescription","longDescription"],
          as: "plan", // Use an alias if defined in the association
          // Replace with actual fields in the Plan table
        },
      ],
      attributes: ["id", "priceAmount"],
    });
    let result = { plans: [] };

    if (prices.length == 0) {
      prices = await Price.findAll({

        include: [
          {


            model: PriceDurations,
            as: "priceDuration", // Use an alias if defined in the association
            // Replace with actual fields in the Duration table
          },
          {
            model: Countries,
            attributes: ["id", "name", "code", "currency"],
            as: "country", // Use an alias if defined in the association
            // Replace with actual fields in the Country table
          },
          {
            model: Plan,
            where: {
              title: {
                [Op.ne]: "Free Trial", // Exclude "Free Trial" plans
              },
              isDefault: true
            },
            //   attributes: ["id", "title","shortDescription","longDescription"],
            as: "plan", // Use an alias if defined in the association
            // Replace with actual fields in the Plan table
          },
        ],
        where: { isDefault: true },
        attributes: ["id", "priceAmount"],
      });
    }



    // Loop through the data and group by plan
    for (let i = 0; i < prices.length; i++) {

      let item = prices[i];
      let planC = item.plan;
      let planTitle = planC.title;

      // Check if the plan already exists in the result
      let planIndex = result.plans.findIndex(
        (plan) => plan.id === item.plan.id
      );

      if (planIndex === -1) {
        result.plans.push({
          id: planC.id,
          title: planTitle,
          shortDescription: planC.shortDescription,
          longDescription: planC.longDescription,

          countries: [
            {
              name: item.country.name,
              id: item.country.id,
              currency: item.country.currency,
              duration: [
                {
                  id: item.priceDuration.id,
                  days: item.priceDuration.duration,
                  priceAmount: item.priceAmount,
                },
              ],
            },
          ],
        });



      } else {
        // If plan exists, find the country and add the duration
        let countryIndex = result.plans[planIndex].countries.findIndex(
          (country) => country.name === item.country.name
        );

        if (countryIndex === -1) {

          // If country doesn't exist, add a new country
          result.plans[planIndex].countries.push({
            name: item.country.name,
            id: item.country.id,
            currency: item.country.currency,

            duration: [
              {
                id: item.priceDuration.id,
                days: item.priceDuration.duration,
                priceAmount: item.priceAmount,
              },
            ],
          });
        } else {
          // If country exists, add the new duration
          result.plans[planIndex].countries[countryIndex].duration.push({
            id: item.priceDuration.id,

            days: item.priceDuration.duration,
            priceAmount: item.priceAmount,
          });
        }
      }
    }



    // Return response
    const response = ApiResponse("1", "All Plans", result);
    return res.json(response);
  } catch (error) {
    console.error("Error fetching plans:", error);

    // Handle errors
    const response = ApiResponse("0", "Error fetching plans", {
      error: error.message,
    });
    return res.status(500).json(response);
  }
}
async function get_plans_admin(req, res) {
  try {
    const prices = await Price.findAll({
      include: [
        {
          model: PriceDurations,
          attributes: ["id", "duration"],
          as: "priceDuration", // Use an alias if defined in the association
        },
        {
          model: Countries,
          attributes: ["id", "name", "code", "currency"],
          as: "country", // Use an alias if defined in the association
        },
        {
          model: Plan,
          as: "plan", // Use an alias if defined in the association
        },
      ],
      attributes: ["id", "priceAmount"],
    });

    let result = { plans: [] };

    // Loop through the data and group by plan
    for (let i = 0; i < prices.length; i++) {
      let item = prices[i];

      // Skip if plan, country, or duration is null
      if (!item.plan || !item.country || !item.priceDuration) {
        continue;
      }

      let planC = item.plan;
      let planTitle = planC.title;

      // Check if the plan already exists in the result
      let planIndex = result.plans.findIndex(
        (plan) => plan.id === item.plan.id
      );

      if (planIndex === -1) {
        // If plan doesn't exist, create a new plan
        result.plans.push({
          id: planC.id,
          title: planTitle,
          catId: planC.CategoryId,
          subId: planC.SubCategoryId,
          shortDescription: planC.shortDescription,
          longDescription: planC.longDescription,
          countries: [
            {
              name: item.country.name,
              id: item.country.id,
              currency: item.country.currency,

              duration: [
                {
                  id: item.priceDuration.id,
                  days: item.priceDuration.duration,
                  priceAmount: item.priceAmount,
                },
              ],
            },
          ],
        });
      } else {
        // If plan exists, find the country and add the duration
        let countryIndex = result.plans[planIndex].countries.findIndex(
          (country) => country.name === item.country.name
        );

        if (countryIndex === -1) {
          // If country doesn't exist, add a new country
          result.plans[planIndex].countries.push({
            name: item.country.name,
            id: item.country.id,
            currency: item.country.currency,

            duration: [
              {
                id: item.priceDuration.id,
                days: item.priceDuration.duration,
                priceAmount: item.priceAmount,
              },
            ],
          });
        } else {
          // If country exists, add the new duration
          result.plans[planIndex].countries[countryIndex].duration.push({
            id: item.priceDuration.id,
            days: item.priceDuration.duration,
            priceAmount: item.priceAmount,
          });
        }
      }
    }

    // Return response
    const response = ApiResponse("1", "All Plans", result);
    return res.json(response);
  } catch (error) {
    console.error("Error fetching plans:", error);

    // Handle errors
    const response = ApiResponse("0", "Error fetching plans", {
      error: error.message,
    });
    return res.status(500).json(response);
  }
}
async function edit_plan(req, res) {
  const { planId, title, shortDescription, longDescription, price } = req.body;
  const plan = await Plan.findOne({ where: { id: planId } });
  if (plan) {
    plan.title = title;
    plan.shortDescription = shortDescription;
    plan.longDescription = longDescription;
    plan.price = price;
    const service_image = req.file;
    let tmpPath = service_image.path;
    let imagePath = tmpPath.replace(/\\/g, "/");
    plan.image = imagePath;
    plan
      .save()
      .then((dat) => {
        const response = ApiResponse("1", "Plan updated successfully!", {});
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", error.message, {});
        return res.json(response);
      });
  } else {
    const response = ApiResponse("0", "Something went wrong", {});
    return res.json(response);
  }
}
async function add_testimonial(req, res) {
  const service_image = req.file;
  let tmpPath = service_image.path;
  let imagePath = tmpPath.replace(/\\/g, "/");

  const test = new Testimonial();
  test.image = imagePath;
  test.status = 1;
  test
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Testimonial added successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}



async function updateDietPlanStatus(req, res) {
  const { id } = req.params;
  const { dietStatus } = req.body;

  // Validate input
  const allowedStatuses = ['pending', 'delayed', 'completed', 'canceled'];
  if (!allowedStatuses.includes(dietStatus)) {
    return res
      .status(400)
      .json(ApiResponse("0", "Invalid diet status value", {}));
  }

  try {
    const record = await PdfDietsForUserNew.findByPk(id);
    if (!record) {
      return res
        .status(404)
        .json(ApiResponse("0", "PDF Diet entry not found", {}));
    }

    record.dietStatus = dietStatus;
    await record.save();

    return res
      .status(200)
      .json(ApiResponse("1", "Diet status updated successfully", { record }));
  } catch (error) {
    console.error("Update error:", error);
    return res
      .status(500)
      .json(ApiResponse("0", "Internal server error", { error: error.message }));
  }
}

async function getDietPlanStatus(req, res) {
  try {
    const pdfDiets = await PdfDietsForUserNew.findAll({
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
        }
      ],
      order: [["date", "DESC"]],
    });

    return res
      .status(200)
      .json(ApiResponse("1", "PDF Diet entries fetched successfully", { pdfDiets }));
  } catch (error) {
    console.error("Fetch error:", error);
    return res
      .status(500)
      .json(ApiResponse("0", "Internal server error", { error: error.message }));
  }
}


// Stamp the consultation-flow cycle anchors on UserPlan when a diet PDF
// is delivered. Used by addDietPdf below.
//
//   firstPlanDeliveredAt — cycle 1 anchor. Set on first delivery only;
//                          frozen thereafter so Day 7 / Day 15 popups
//                          fire at the right offset even when the plan
//                          is updated mid-cycle.
//   latestPlanDeliveredAt — cycle 2 anchor. Updated on every delivery
//                           so a re-uploaded plan rolls the user into
//                           a fresh cycle 2 review window.
//
// Idempotent: missing UserPlan row (or DB error) just logs and continues
// — never fails the upload itself, since users have already been told
// the plan was delivered via push.
async function stampPlanDeliveryAnchors(userPlanId, { isFirstDelivery }) {
  if (!userPlanId) return;
  const plan = await UserPlan.findByPk(userPlanId);
  if (!plan) return;

  const now = new Date();
  const updates = { latestPlanDeliveredAt: now };
  // Only seed firstPlanDeliveredAt + cycle1StartedAt the first time.
  if (isFirstDelivery && !plan.firstPlanDeliveredAt) {
    updates.firstPlanDeliveredAt = now;
    updates.cycle1StartedAt = now;
  }
  // cycle2StartedAt only stamps on a re-delivery (not first).
  if (!isFirstDelivery && !plan.cycle2StartedAt) {
    updates.cycle2StartedAt = now;
  }
  await plan.update(updates);
}

async function addDietPdf(req, res) {
  const userPlanId = req.body.userPlanId;
  const image = req.file;
  const userId = req.body.userId;
  // Handle the case where no image is provided
  let imagePath = image ? image.path.replace(/\\/g, "/") : null;

  try {
    // Check if the user exists
    const user = await User.findOne({ where: { id: userId } });

    if (!user) {
      // If user not found, return an error response
      let response = ApiResponse("0", "User not found", {});
      return res.json(response);
    }

    // Check if a PDF entry already exists for the user and plan
    const existingPdfDiet = await PdfDietsForUserNew.findOne({
      where: { userId: userId, userPlanId: userPlanId },
    });

    if (existingPdfDiet) {
      // Update the existing entry
      existingPdfDiet.pdfFile = imagePath || existingPdfDiet.pdfFile; // Keep the old path if no new image is provided
      await existingPdfDiet.save();

      // Consultation-flow cycle anchors. Re-uploading a PDF for an
      // existing plan moves cycle 2 forward (Day 15 → 30 phase). cycle1
      // and firstPlanDeliveredAt stay frozen on the original delivery.
      try {
        await stampPlanDeliveryAnchors(userPlanId, { isFirstDelivery: false });
      } catch (e) {
        console.error("[addDietPdf] cycle anchor update failed:", e);
      }

      // Send notification if deviceToken exists
      if (user.deviceToken) {
        let notification = {
          title: "Diet Plan Updated",
          body: "Your diet plan has been updated.",
        };
        sendNotification([user.deviceToken], notification, { type: "dietPlanUpdated" });
      }

      // Return success response for update
      const response = ApiResponse("1", "Diet PDF updated successfully!", {});
      return res.json(response);
    } else {
      // Create and save a new pdfDiet entry
      const pdfDietEntry = new PdfDietsForUserNew({
        pdfFile: imagePath,
        status: true,
        userId: userId,
        userPlanId: userPlanId,
        date:new Date()
      });

      await pdfDietEntry.save();

      // First-time delivery: stamp both firstPlanDeliveredAt (cycle 1
      // anchor — frozen) and latestPlanDeliveredAt (cycle 2 anchor —
      // moves on subsequent uploads). Day 7 / 15 / 30 popup eligibility
      // is computed against these.
      try {
        await stampPlanDeliveryAnchors(userPlanId, { isFirstDelivery: true });
      } catch (e) {
        console.error("[addDietPdf] cycle anchor seed failed:", e);
      }

      // Send notification if deviceToken exists
      if (user.deviceToken) {
        let notification = {
          title: "Diet Plan Added",
          body: "Your diet plan has been added.",
        };
        sendNotification([user.deviceToken], notification, { type: "dietPlanAdded" });
      }

      // Return success response for new entry
      const response = ApiResponse("1", "Diet PDF added successfully!", {});
      return res.json(response);
    }
  } catch (error) {
    // Send error response
    const response = ApiResponse("0", error.message, {});
    return res.status(500).json(response); // It's good to send a status code for errors
  }
}


async function getDietPdf(req, res) {
  const { userPlanId, userId } = req.body; // Destructure userPlanId and userId from the request body

  try {
    // Find the record that matches both userPlanId and userId
    let details = await PdfDietsForUserNew.findOne({
      where: {
        userPlanId: userPlanId,
        userId: userId,
      },
    });

    // Return a response with the details
    return res.json(ApiResponse("1", "Details", { details }));
  } catch (error) {
    // Return a response with the error if something goes wrong
    return res.json(ApiResponse("0", error.message, {}));
  }
}

async function activate_plan(req, res) {
  const plan = await Plan.findOne({ where: { id: req.body.planId } });
  plan.status = true;
  plan
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Plan activated successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}
async function block_plan(req, res) {
  const plan = await Plan.findOne({ where: { id: req.body.planId } });
  plan.status = false;
  plan
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Plan blocked successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}
async function get_all_users(req, res) {
  try {
    // Fetch users
    const users = await User.findAll({
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "phone",
        "status",
        "freeze",
      ],
    });

    // Separate lists for categorizing users
    const freeTrialList = [];
    const otherPlansList = [];

    // Process each user
    await Promise.all(
      users.map(async (user) => {
        // Fetch user plans
        const userPlans = await UserPlan.findOne({
          where: { UserId: user.id },
          attributes: ["id", "expireDate", "buyingDate"],
          include: {
            model: Plan,
            attributes: [
              "id",
              "title",
              "shortDescription",
              "longDescription",
            ],
          },
        });

        // Check if user has a plan and categorize accordingly
        const userObj = {
          user: user,
          plans: userPlans || null, // Set to null if no plans
        };

        if (userPlans && userPlans.Plan && userPlans.Plan.title === "Free Trial") {
          freeTrialList.push(userObj);
        } else {
          otherPlansList.push(userObj);
        }
      })
    );

    // Return the categorized lists
    const response = ApiResponse("1", "All Custom Support Users", {
      freeTrialUsers: freeTrialList,
      otherPlanUsers: otherPlansList,
    });
    return res.json(response);
  } catch (error) {
    console.error(error);
    const response = ApiResponse("0", "Error fetching users", {
      error: error.message,
    });
    return res.status(500).json(response);
  }
}

async function delete_user(req, res) {
  try {
    let user = await User.findOne({
      where: { id: req.body.userId, userType: "User" },
    });
    if (user) {
      let userPlans = await UserPlan.findAll({ where: { UserId: user.id } });
      if (userPlans) {
        for (const userPlan of userPlans) {
          await userPlan.destroy();
        }
      }
      await user.destroy();
      const response = ApiResponse("1", "User deleted successfully!", {});
      return res.json(response);
    } else {
      const response = ApiResponse("0", "User not found!", {});
      return res.json(response);
    }
  } catch (error) {
    console.error("An error occurred while deleting user:", error);
    const response = ApiResponse("0", error.message, {});
    return res.status(500).json(response);
  }
}

async function get_all_dietitions(req, res) {
  const users = await User.findAll({ where: { userType: "Dietition" } });
  const response = ApiResponse("1", "All Users", users);
  return res.json(response);
}
async function get_all_trainers(req, res) {
  const users = await User.findAll({ where: { userType: "Trainer" } });
  const response = ApiResponse("1", "All Users", users);
  return res.json(response);
}
async function activate_user(req, res) {
  const user = await User.findOne({ where: { id: req.body.userId } });
  user.status = true;
  user
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "User activated successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}
async function block_user(req, res) {
  const user = await User.findOne({ where: { id: req.body.userId } });
  user.status = false;
  user
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "User blocked successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}
async function users_plans(req, res) {
  const plans = await UserPlan.findAll({
    include: [
      {
        model: User,
        attributes: ["id", "firstName", "lastName", "email", "phone"],
      },
      { model: Plan },
    ],
  });
  const response = ApiResponse("1", "Users Plans", plans);
  return res.json(response);
}

async function get_all_plans(req, res) {
  const plans = await Plan.findAll({});
  const categories = await Category.findAll({ where: { status: true } });
  const data = {
    plans: plans,
    categories: categories,
  };
  const response = ApiResponse("1", "All Plans", data);
  return res.json(response);
}

async function getAllHealthTips(req, res) {
  const healthTips = await HealthTips.findAll({});
  const data = {
    healthTips: healthTips,
  };
  const response = ApiResponse("1", "All Health Tips", data);
  return res.json(response);
}

async function add_service(req, res) {
  const { title, desc } = req.body;
  const check = await Service.findOne({ where: [{ title: title }] });
  if (check) {
    const response = ApiResponse("0", "Service Already exist", {});
    return res.json(response);
  } else {
    const service = new Service();
    service.title = title;
    service.desc = desc;
    service.status = 1;
    service
      .save()
      .then((dat) => {
        const response = ApiResponse("1", "Service added successfully!", {});
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", "Something went wrong", {});
        return res.json(response);
      });
  }
}

async function get_all_services(req, res) {
  const services = await Service.findAll({});
  const response = ApiResponse("1", "All Services", services);
  return res.json(response);
}

async function activate_service(req, res) {
  const service = await Service.findOne({ where: { id: req.body.serviceId } });

  if (service) {
    service.status = true;
    service
      .save()
      .then((dat) => {
        const response = ApiResponse("1", "Activated successfully!", {});
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", "Something went wrong!", {});
        return res.json(response);
      });
  } else {
    const response = ApiResponse("0", "Something went wrong!", {});
    return res.json(response);
  }
}
async function block_service(req, res) {
  const service = await Service.findOne({ where: { id: req.body.serviceId } });
  if (service) {
    service.status = false;
    service
      .save()
      .then((dat) => {
        const response = ApiResponse("1", "Blocked successfully!", {});
        return res.json(response);
      })
      .catch((error) => {
        const response = ApiResponse("0", "Something went wrong!", {});
        return res.json(response);
      });
  } else {
    const response = ApiResponse("0", "Something went wrong!", {});
    return res.json(response);
  }
}

async function update_service(req, res) {
  const service = await Service.findOne({ where: { id: req.body.id } });
  service.title = req.body.title;
  service.desc = req.body.desc;
  service
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Service updated", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", "Something went wrong", {});
      return res.json(response);
    });
}

async function add_category(req, res) {
  const { title } = req.body;
  const check = await Category.findOne({ where: { title: title } });
  if (check) {
    const response = ApiResponse("0", "Already exists", {});
    return res.json(response);
  } else {
    const category = new Category();
    category.title = title;
    category.status = 1;
    category.save().then((dat) => {
      const response = ApiResponse("1", "Category added successfully!", {});
      return res.json(response);
    });
  }
}

async function all_categories(req, res) {
  const categories = await Category.findAll({ attributes: ["id", "title"] });
  const response = ApiResponse("1", "All Categories", {
    categories: categories,
  });
  return res.json(response);
}

async function get_subcategories(req, res) {
  const { categoryId } = req.params;
  let data = await SubCategory.findAll({
    where: { CategoryId: categoryId },
    attributes: ["id", "title"],
  });
  let response = ApiResponse("1", "Sub Categories", { data });
  return res.json(response);
}

async function udpate_category(req, res) {
  const category = await Category.findByPk(req.body.id);
  category.title = req.body.title;
  category
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Updated successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", "Somehting went wrong", {});
      return res.json(response);
    });
}

async function get_all_contact_messages(req, res) {
  const messages = await Contact.findAll({});
  const response = ApiResponse("1", "All messages", messages);
  return res.json(response);
}

async function dieitionPlans(req, res) {
  let data = await PlanDietition.findAll({
    where: { DeititionId: req.user.id },
    include: [{ model: UserPlan, include: [{ model: User }, { model: Plan }] }],
  });
  let response = ApiResponse("1", "Dietition Plans", data);
  return res.json(response);
}

async function update_dietition_link(req, res) {
  try {
    const { userPlanId, link } = req.body;
    const data = await UserPlan.findOne({ where: { id: userPlanId } });

    if (!data) {
      // If no plan is found
      let response = ApiResponse("0", "User plan not found", {});
      return res.json(response);
    }

    // Find the associated user
    const user = await User.findOne({ where: { id: data.UserId } });

    if (!user) {
      // If user not found, return an error response
      let response = ApiResponse("0", "User not found", {});
      return res.json(response);
    }

    // Update dietitian link
    data.dietitionLink = link;
    await data.save();

    // Send notification if deviceToken exists
    if (user.deviceToken) {
      let notification = {
        title: "Class Link Added",
        body: "Join the session now",

      };
      let data = {
        type: "classLinkAdded",
        isTrainer: false, // Adding isTrainer flag in the notification payload
      };
      sendNotification([user.deviceToken], notification, data);
    }

    let response = ApiResponse("1", "Link updated successfully", {});
    return res.json(response);
  } catch (error) {
    // Catch any unexpected error
    let response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

// async function update_trainer_link(req, res) {
//   const { planId, link } = req.body;
//   const data = await UserPlan.findOne({ where: { id: planId } });

//   if (data) {
//     data.trainerLink = link;
//     data
//       .save()
//       .then((dat) => {
//         let response = ApiResponse("1", "Link Updated successfully", {});
//         return res.json(response);
//       })
//       .catch((error) => {
//         let response = ApiResponse("0", error.message, {});
//         return res.json(response);
//       });
//   } else {
//     let response = ApiResponse("0", "Not found", {});
//     return res.json(response);
//   }
// }
async function update_trainer_link(req, res) {
  try {
    const { planId, link } = req.body;
    const data = await UserPlan.findOne({ where: { id: planId } });

    if (!data) {
      // If no plan is found
      let response = ApiResponse("0", "User plan not found", {});
      return res.json(response);
    }

    // Find the associated user
    const user = await User.findOne({ where: { id: data.UserId } });

    if (!user) {
      // If user not found, return an error response
      let response = ApiResponse("0", "User not found", {});
      return res.json(response);
    }

    // Update trainer link
    data.trainerLink = link;
    await data.save();

    // Send notification if deviceToken exists
    if (user.deviceToken) {
      let notification = {
        title: "Class Link Added",
        body: "Join the session now",

      };
      let data = {
        type: "trainerLinkAdded",
        isTrainer: true, // Adding isTrainer flag in the notification payload
      };
      sendNotification([user.deviceToken], notification, data);
    }

    let response = ApiResponse("1", "Link updated successfully", {});
    return res.json(response);
  } catch (error) {
    // Catch any unexpected error
    let response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function dietitionHome(req, res) {
  const { userId } = req.params;

  // Fetch the assigned plans including user and user plan information
  let assigned = await AssignedPlan.findAll({
    attributes: ["id"],
    where: { UserId: userId },
    include: {
      model: Plan,
      attributes: ["id", "title"],
      include: {
        model: UserPlan,
        include: {
          model: User,
          attributes: ["id", "firstName", "lastName", "email", "phone"],
        },
      },
    },
  });

  // Extract and format the user and user plan details
  const result = assigned.flatMap((plan) =>
    plan.Plan.UserPlans.map((userPlan) => ({
      UserPlan: {
        title: plan.Plan.title, // Include the plan title here
        id: userPlan.id,
        buyingDate: userPlan.buyingDate,
        expireDate: userPlan.expireDate,
        price: userPlan.price,
        dietitionLink: userPlan.dietitionLink,
        status: userPlan.status,
        createdAt: userPlan.createdAt,
        updatedAt: userPlan.updatedAt,
        User: userPlan.User,
      },
    }))
  );

  return res.json(ApiResponse("1", "Data", { result }));
}



// ⚠️  DISCONNECTED FLOW WARNING
// assignFreePlan creates a UserPlan + sets user.usedFreeTrial=1, but it does NOT
// call createFreeTrialUser. That means users assigned a trial via this endpoint
// will NOT have FreeTrailUsers or FreeTrailUsersSlots rows.
//
// Downstream effects:
//   - getFreeTrialUserById will return nothing for these users (trainer sees empty list)
//   - freeTrialExpiry.js handles the missing FreeTrailUsers row gracefully (null check)
//   - changeFreeTrialStatus relies on FreeTrailUsers — will silently no-op for these users
//
// If you need the full free-trial experience (slot visibility, prefs, trainer view),
// the admin UI must call createFreeTrialUser separately after calling this endpoint,
// or this function needs to be merged with createFreeTrialUser in a future refactor.
async function assignFreePlan(req, res) {
  const {
    userId, country
  } = req.body;
  try {
    // Check if email or phone already exists
    const user = await User.findOne({ where: { id: userId } });
    // If no planId, assign Free Trial plan
    let freePlan = await Plan.findOne({ where: { title: "Free Trial" } });
    const prices = await Price.findAll({
      where: { planId: freePlan.id }, // `where` clause for filtering
      include: [
        {
          model: Countries, // Associated model
          attributes: ["id", "name", "code"], // Attributes to include from the associated model
          as: "country", // Alias used for the association (if defined)
        },
      ],
      attributes: ["id", "priceAmount"], // Attributes to include from the `Price` table
    });
    const countryExists = prices.some(
      (price) => price.country.name === country
    );


    //   let freePlan = await Plan.findOne({ where: { CategoryId: freeCategory.id } });

    if (!countryExists) {
      const response = ApiResponse(
        "0",
        `Your country is not listed in free trial. Stay Tuned!`,
        {}
      );
      return res.json(response);
    }

    if (user.usedFreeTrial) {
      // alreadyUsed:true is a machine-readable field so Flutter doesn't need
      // to match on the message string (which is fragile against typo fixes).
      return res.json(ApiResponse(
        "0",
        `You can't subscribe free trial at this movement`,
        { alreadyUsed: true }
      ));
    }

    // Cross-system check: this legacy endpoint only ever looked at
    // usedFreeTrial, which the current TrialJourney system (trialController.js)
    // never sets. A user who already ran a TrialJourney (or has one in
    // progress) could still be handed a second free plan through here.
    // Belt-and-braces alongside the equivalent check added to startTrial().
    const existingJourney = await TrialJourney.findOne({ where: { userId } });
    if (existingJourney) {
      return res.json(ApiResponse(
        "0",
        `You can't subscribe free trial at this movement`,
        { alreadyUsed: true }
      ));
    }

    if (freePlan) {
      let userPlan = new UserPlan();
      let now = new Date();
      let days = 0;
      if (freePlan.status) {
        let price = await Price.findOne({ where: { planId: freePlan.id } });
        let duration = await PriceDurations.findOne({
          where: { id: price.durationId },
        });
        const str = duration.duration;
        days = parseInt(str.match(/\d+/)[0], 10);
        userPlan.PlanId = freePlan.id;
        userPlan.userId = user.id;
        userPlan.buyingDate = now;
        userPlan.expireDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        userPlan.price = freePlan.price;
        userPlan.status = 1;
        user.status = true;
        user.usedFreeTrial = 1;
        await userPlan.save();
        await user.save();
        const response = ApiResponse(
          "1",
          `Free plan activated`,
          {}
        );
        return res.json(response);
      }
    }
    else {
      const response = ApiResponse(
        "1",
        `You can't subscribe free trial at this movement`,
        {}
      );
      return res.json(response);
    }

    // // Save the user plan
    // Generate JWT access token
    // Update user with deviceToken


  } catch (error) {
    console.error(error); // Log the error for debugging
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}
async function addUserDetails(req, res) {
  try {
    const {
      userId,
      age,
      height,
      weight,
      bmiResult,
      mainGoal,
      healthConditions
    } = req.body;

    const user = await User.findOne({ where: { id: userId } });

    if (user) {
      user.age = age;
      user.height = height;
      user.weight = weight;
      user.bmiResult = bmiResult;
      if (mainGoal !== undefined) user.mainGoal = mainGoal;
      if (healthConditions !== undefined) user.healthConditions = healthConditions;

      await user.save();

      // Best-effort side effect: anchor weight-progress math by creating the
      // user's first WeeklyCheckin row for this week. Idempotent via the
      // (userId, weekDate) unique index + findOrCreate. Isolated try/catch
      // so a bad weight string never mangles the signup response.
      try {
        const parsedWeight = parseFloat(user.weight);
        if (!isNaN(parsedWeight) && parsedWeight > 0) {
          await WeeklyCheckin.findOrCreate({
            where: { userId: user.id, weekDate: currentWeekMonday() },
            defaults: { weightKg: parsedWeight },
          });
        }
      } catch (wcErr) {
        console.error(
          "[addUserDetails] WeeklyCheckin anchor failed (non-fatal):",
          wcErr
        );
      }

      const response = ApiResponse("1", "Successfully Updated", {});
      return res.json(response);
    } else {
      const response = ApiResponse("0", "User not found", {});
      return res.status(404).json(response);
    }
  } catch (error) {
    const response = ApiResponse("0", "User not found", {});
    return res.status(200).json(response);
  }
}




async function addUser(req, res) {
  const {
    firstName,
    lastName,
    email,
    phone,
    password,
    planId,
    price,
    status,
    durationId,
    customSupporterId,
    deviceToken,
    age,
    height,
    weight,
    bmiResult,
    timeZone
  } = req.body;
  try {
    // Check if email or phone already exists
    const checkEmail = await User.findOne({ where: { email: email } });
    const checkPhone = await User.findOne({ where: { phone: phone } });
    if (checkEmail) {
      const response = ApiResponse("0", "Email already exists", {});
      return res.json(response);
    }
    if (checkPhone) {
      const response = ApiResponse("0", "Phone No. already exists", {});
      return res.json(response);
    }
    // Hash password and create new user
    const salt = await bcrypt.genSalt(10);
    let user = new User();
    user.firstName = firstName;
    user.lastName = lastName;
    user.email = email;
    user.status = status;
    user.phone = phone;
    user.timeZone = timeZone;
    user.userType = "User";
    user.password = await bcrypt.hash(password, salt);
    user.customSupporter = customSupporterId;
    user.age = age,
      user.weight = weight;
    user.bmiResult = bmiResult;
    user.height = height;
    await user.save();
    // Initialize UserPlan variables
    let userPlan = new UserPlan();
    let now = new Date();
    let days = 0;
    // Create UserPlan based on provided status and planId or free trial
    if (status && planId) {
      let pl = await Plan.findOne({ where: { id: planId } });
      let duration = await PriceDurations.findOne({
        where: { id: durationId },
      });

      if (pl) {
        const str = duration.duration;
        days = parseInt(str.match(/\d+/)[0], 10);
        userPlan.PlanId = planId;
        userPlan.userId = user.id;
        userPlan.price = price;

        userPlan.buyingDate = now;
        userPlan.expireDate = new Date(
          now.getTime() + days * 24 * 60 * 60 * 1000
        );
        userPlan.durationIdPlan = durationId;
        userPlan.price = pl.price;
        userPlan.status = 1;
        await userPlan.save();
      }
    }

    // else {
    //   // If no planId, assign Free Trial plan
    //   let freePlan = await Plan.findOne({ where: { title: "Free Trial" } });
    // //   let freePlan = await Plan.findOne({ where: { CategoryId: freeCategory.id } });
    //   if (freePlan) {
    //     if(freePlan.status) {
    //     let price = await Price.findOne({ where: { planId: freePlan.id } });
    //     let duration = await PriceDurations.findOne({
    //     where: { id: price.durationId },
    //   });
    //     const str = duration.duration;
    //     days = parseInt(str.match(/\d+/)[0], 10);
    //     userPlan.PlanId = freePlan.id;
    //     userPlan.userId = user.id;
    //     userPlan.buyingDate = now;
    //     userPlan.expireDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    //     userPlan.price = freePlan.price;
    //     userPlan.status = 1;
    //     user.status=true;
    //     await userPlan.save();
    //     await user.save();
    //     }
    //   }
    // }
    // // Save the user plan
    // Generate JWT access token
    const accessToken = sign(
      { email: user.email, id: user.id },
      process.env.JWT_ACCESS_SECRET
    );
    // Update user with deviceToken
    user.deviceToken = deviceToken;
    await user.save();
    // Fetch admin data
    let adminData = await User.findOne({ where: { userType: "Admin" } });
    if (customSupporterId) {
      let supporter = await User.findOne({ where: { userType: "Customer_Support_Representative" } });
      if (supporter) {
        if (supporter.deviceToken) {
          let notification = {
            title: "A New user Assigned to you",
            body: `${firstName} ${lastName} has been added to your users list`,
          };
          sendNotification([supporter.deviceToken], notification, { type: "csrUserAssigned" });
        }

      }


    }


    // Prepare response data
    let data = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      adminId: adminData ? adminData.id : 0,
      email: user.email,
      status: user.status,
      accessToken: accessToken,
      userType: user.userType,
      useNewPaidHome: user.useNewPaidHome ?? false,
      useNewUnpaidHome: user.useNewUnpaidHome ?? false,
    };
    const response = ApiResponse(
      "1",
      `${firstName} ${lastName} Registered successfully!`,
      data
    );
    return res.json(response);
  } catch (error) {
    console.error(error); // Log the error for debugging
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function addTeamMember(req, res) {
  const { firstName, lastName, email, phone, password, userType, planId } =
    req.body;
  const checkEmail = await User.findOne({ where: { email: email } });
  const checkPhone = await User.findOne({ where: { phone: phone } });
  if (checkEmail) {
    const response = ApiResponse("0", "Email already exists", {});
    return res.json(response);
  }
  if (checkPhone) {
    const response = ApiResponse("0", "Phone No. already exists", {});
    return res.json(response);
  }
  const salt = await bcrypt.genSalt(10);
  let user = new User();
  user.firstName = firstName;
  user.lastName = lastName;
  user.email = email;
  user.status = 1;
  user.phone = phone;
  user.userType = userType;
  user.password = await bcrypt.hash(password, salt);
  try {
    await user.save();
    if (userType != "Customer_Support_Representative") {
      let assigned = new AssignedPlan();
      if (userType == "Trainer") {
        assigned.trainerId = user.id;
      } else {
        assigned.UserId = user.id;
      }
      assigned.PlanId = planId;
      await assigned.save();
    }
    const response = ApiResponse(
      "1",
      `${firstName} ${lastName} Registered successfully!`,
      {}
    );
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}
async function addTrainer(req, res) {
  const { firstName, lastName, email, phone, password } = req.body;
  const checkEmail = await User.findOne({ where: { email: email } });
  const checkPhone = await User.findOne({ where: { phone: phone } });
  if (checkEmail) {
    const response = ApiResponse("0", "Email already exists", {});
    return res.json(response);
  }
  if (checkPhone) {
    const response = ApiResponse("0", "Phone No. already exists", {});
    return res.json(response);
  }

  const salt = await bcrypt.genSalt(10);
  let user = new User();
  user.firstName = firstName;
  user.lastName = lastName;
  user.email = email;
  user.status = 1;
  user.phone = phone;
  user.userType = "Trainer";
  user.password = await bcrypt.hash(password, salt);

  try {
    await user.save();

    const response = ApiResponse(
      "1",
      `${firstName} ${lastName} Registered successfully!`,
      {}
    );
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function getAllDeititions(req, res) {
  let dietitions = await User.findAll({
    where: { status: true, userType: "Dietition" },
    attributes: ["id", "firstName", "lastName", "email", "phone"],
  });
  let trainers = await User.findAll({
    where: { status: true, userType: "Trainer" },
    attributes: ["id", "firstName", "lastName", "email", "phone"],
  });
  let data = {
    dietitions,
    trainers,
  };
  let response = ApiResponse("1", "Data", data);
  return res.json(response);
}

async function getAllActivePlans(req, res) {
  let plans = await Plan.findAll({
    where: { status: true },
    attributes: ["id", "title", "price"],
    include: { model: Category, attributes: ["title"] },
  });
  let data = {
    plans,
  };
  let response = ApiResponse("1", "all Active Plans", data);
  return res.json(response);
}

async function get_testimonials(req, res) {
  const test = await Testimonial.findAll();
  const response = ApiResponse("1", "All Testimonail", test);
  return res.json(response);
}


async function addAnnouncement(req, res) {
  try {
    const { title, body } = req.body;

    // Validate input
    if (!title || !body) {
      return res.status(400).json(ApiResponse("0", "Title and body are required", {}));
    }

    // Save announcement
    const announcement = await Announcement.create({
      title,
      body,
      status: 1,
    });

    // Fetch users with valid device tokens
    const users = await User.findAll({
      where: {
        userType: "User",
        deviceToken: {
          [Op.ne]: null, // Not null
        },
      },
      attributes: ["deviceToken"],
    });

    const deviceTokens = users.map((user) => user.deviceToken).filter(Boolean);

    // Send notifications if tokens exist
    if (deviceTokens.length > 0) {
      const notification = { title, body, };
      await sendNotification(deviceTokens, notification, {
        type: "announcement",
        announcement: JSON.stringify(true),
        annoucement: JSON.stringify(true),
      });
    }

    return res.json(ApiResponse("1", "Announcement sent successfully", { announcementId: announcement.id }));
  } catch (error) {
    console.error("Error in addAnnouncement:", error);
    return res.status(500).json(ApiResponse("0", "Internal server error", {}));
  }
}


// Authoritative wall-clock for the Flutter AppClock. The client computes
// `offset = server.ms - device.now()` once at app launch and uses
// `device.now() + offset` everywhere a slot resolver needs "now". Tiny
// payload — should round-trip in under 100ms even on slow connections,
// which keeps the offset estimate tight.
async function serverTime(req, res) {
  const now = new Date();
  return res.json(
    ApiResponse("1", "Server time", {
      iso: now.toISOString(),
      ms: now.getTime(),
    })
  );
}

// Lightweight read used by the Flutter heartbeat (every 30s) and by smart
// triggers (foreground/reconnect/boundary). Returns only the fields the
// resolver/presentation needs — keeps the call cheap so polling at 30s
// cadence is OK across many users.
async function slotStatus(req, res) {
  const { id } = req.params;
  try {
    const slot = await Slot.findOne({
      where: { id },
      attributes: [
        "id",
        "status",
        "trainerLink",
        "isTrainerJoined",
        "joinedUserUID",
      ],
    });
    if (!slot) {
      return res.json(ApiResponse("0", "Slot not found", {}));
    }
    return res.json(ApiResponse("1", "Slot status", { slot }));
  } catch (err) {
    console.error("AdminController.slotStatus:", err);
    return res
      .status(500)
      .json({ status: "0", message: "Internal server error" });
  }
}

async function trainerHome(req, res) {
  const { userId } = req.params;

  try {
    // Trainer's own timezone — render times in their local wall clock.
    let trainerTz = SLOT_DEFAULT_TZ;
    try {
      const u = await User.findOne({
        where: { id: userId },
        attributes: ["id", "timeZone"],
      });
      if (u && u.timeZone) trainerTz = u.timeZone;
    } catch (_) { /* fall back to default */ }

    const slots = await Slot.findAll({
      where: { trainerId: userId },
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email"] },
        { model: Time, attributes: ["id", "day"] },
      ],
    });

    return res.json(ApiResponse("1", "Details", {
      trainerSlots: groupSlotsByLocalWeekday(slots, trainerTz),
    }));
  } catch (error) {
    console.error("Error fetching trainer plans:", error);
    return res
      .status(500)
      .json({ status: "0", message: "Internal server error" });
  }
}



// async function updateLink(req, res) {
//   const { slotId, link, userId } = req.body;
//   const slot = await Slot.findOne({ where: { id: slotId } });
//   const user = await User.findOne({ where: { id: userId } });
//   if (slot) {
//     slot.trainerLink = link;
//     await slot.save();

//     let notification = {
//       title: "Class link Added",
//       body: "Join the session now",
//     };

//     sendNotification([user?.deviceToken], notification);
//     const response = ApiResponse("1", "Link updated successfully", {});
//     return res.json(response);
//   } else {
//     const response = ApiResponse("0", "Slot not found", {});
//     return res.json(response);
//   }
// }
async function updateLink(req, res) {
  try {
    const { slotId, link, channel } = req.body;

    const slot = await Slot.findOne({ where: { id: slotId } });

    if (!slot) {
      return res.json(ApiResponse("0", "Slot not found", {}));
    }

    slot.trainerLink = link;
    slot.status = "Class is starting soon";

    await slot.save();

    const trainer = await User.findOne({
      attributes: ["id", "firstName", "lastName", "email"],
      where: {
        id: slot?.trainerId
      },
    });


    let data = {
      "upcomingSlot": JSON.stringify(slot ?? {}),
      "trainer": JSON.stringify(trainer ?? {}),
    };

    const io = getIO();
    console.log("⏳ Emitting slotUpdate...");
    io.emit("slotUpdate", data);
    console.log("✅ slotUpdate emitted successfully");

    // deviceTokens was previously omitted here, which meant the worker
    // always found an empty recipient list and silently dropped the push.
    // TYPE_BY_TITLE in helper/notification.js already maps "Class Link
    // Added" → classLinkAdded, so no explicit data.type is needed.
    const deviceTokens = await getDeviceTokensForSlot(slot);
    await notificationQueue.add({
      title: "Class Link Added",
      body: "Class is starting soon",
      data: data,
      deviceTokens,
    });

    return res.json(ApiResponse("1", "Link updated. Notifications will be sent.", {}));
  } catch (error) {
    return res.json(ApiResponse("0", error.message, {}));
  }
}

async function updateTrainerJoin(req, res) {
  try {
    const { isTrainerJoined, joinedUserUID, slotId } = req.body; // Removed userId as it's not needed for all users

    // Freeze gate — when a regular User is joining the class
    // (joinedUserUID is set, isTrainerJoined is not true), block if
    // their plan is paused. Trainer-side calls (isTrainerJoined=true)
    // pass through unchanged. See helper/freezeGate.js.
    if (isTrainerJoined !== true && joinedUserUID) {
      const frozenPlan = await findFrozenActivePlan(joinedUserUID);
      if (frozenPlan) {
        return res.json(
          ApiResponse(
            "0",
            "Your plan is paused. Resume it from your profile to join workouts.",
            { isFrozen: true, frozenAt: frozenPlan.frozenAt }
          )
        );
      }
    }

    // Find the slot by ID
    const slot = await Slot.findOne({ where: { id: slotId } });

    if (!slot) {
      // If slot not found, send error response
      return res.json(ApiResponse("0", "Slot not found", {}));
    }

    // Update the trainer link for the slot
    slot.isTrainerJoined = isTrainerJoined;
    slot.joinedUserUID = joinedUserUID;
    await slot.save();
    if (isTrainerJoined === true) {
      const trainer = await User.findOne({
        attributes: ["id", "firstName", "lastName", "email"],
        where: { id: slot?.trainerId },
      });
      const data = {
        upcomingSlot: JSON.stringify(slot ?? {}),
        trainer: JSON.stringify(trainer ?? {}),
      };

      // This previously had no socket emit at all (open-app users got
      // nothing) and queued the push with no deviceTokens (closed-app
      // users got nothing either) — same missing-roster bug as
      // updateLink, fixed the same way. TYPE_BY_TITLE already maps
      // "Trainer has Joined" → classStart.
      const io = getIO();
      io.emit("slotUpdate", data);

      const deviceTokens = await getDeviceTokensForSlot(slot);
      await notificationQueue.add({
        title: "Trainer has Joined",
        body: "Please join trainer has joined the class",
        data,
        deviceTokens,
      });
    }


    const response = ApiResponse(
      "1",
      "Link updated and notifications sent successfully",
      {}
    );
    return res.json(response);
  } catch (error) {
    // Catch and return unexpected errors
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function sendNotificaionTest(req, res) {
  try {
    const tokenFromRequest = req.body?.deviceToken || req.query?.deviceToken;
    const tokenFromEnv = process.env.NOTIFICATION_TEST_TOKEN;
    const deviceTokens = [tokenFromRequest || tokenFromEnv].filter(Boolean);

    if (deviceTokens.length === 0) {
      return res.json(ApiResponse("0", "Set NOTIFICATION_TEST_TOKEN or pass deviceToken", {}));
    }

    const notification = {
      title: "Class Link Added",
      body: "Join the session now",

    };
    const data = {
      type: "trainerLinkAdded",
      isTrainer: "true", // Include additional data if necessary
    };

    // Send notification to device tokens
    const notificationResponse = await sendNotification(deviceTokens, notification, data);

    const response = ApiResponse(
      "1",
      "Link updated and notifications sent successfully",
      {

      }
    );
    return res.json(response);
  } catch (error) {
    // Catch unexpected errors
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}
async function updateDietitionLink(req, res) {
  const { id, link, userId } = req.body;

  // const plan = await UserPlan.findOne({ where: { id: id } });
  // if (plan) {
  //   plan.dietitionLink = link;
  //   await plan.save();
  //   const user = await User.findOne({ where: { id: userId } });
  //   let notification = {
  //     title: "Class link Added",
  //     body: "Join the session now",
  //   };
  const slot = await SlotDiet.findOne({ where: { id: id } });
  if (!slot) {
    const response = ApiResponse("0", "Slot not found", {});
    return res.json(response);
  }

  // Ownership check — this endpoint had NO auth at all before (anyone
  // who knew the URL could overwrite any dietitian's link, or spam a
  // notification to any client). Now it's behind validateToken +
  // validateAdmin, so req.user.id is the logged-in staff member; make
  // sure they're only touching a slot that's actually theirs.
  if (slot.dietitionId !== req.user.id) {
    const response = ApiResponse("0", "You can only update your own slots.", {});
    return res.json(response);
  }

  slot.dietitionLink = link;
  await slot.save();

  // userId is now optional — the dietitian link tool just updates the
  // slot template and doesn't pick a specific client. Only notify when
  // a real userId with a device token was actually supplied. (This also
  // fixes a pre-existing crash: the old code called
  // sendNotification([user.deviceToken], ...) even when User.findOne
  // came back null, throwing on .deviceToken.)
  if (userId) {
    const notifyUser = await User.findOne({ where: { id: userId } });
    if (notifyUser && notifyUser.deviceToken) {
      let notification = {
        title: "Class Link Added",
        body: "Join the session now",
      };
      sendNotification([notifyUser.deviceToken], notification, { type: "classLinkAdded", isTrainer: "false" });
    }
  }

  const response = ApiResponse("1", "Link updated successfully", {});
  return res.json(response);
}

// Lists the logged-in dietitian's own SlotDiet templates with their
// day/time and whatever link is currently saved. Backs the new
// dietitian link tool page (public/dietitian-link-tool.html) — scoped
// to req.user.id so a dietitian only ever sees her own slots.
async function getMyDietSlots(req, res) {
  const slots = await SlotDiet.findAll({
    where: { dietitionId: req.user.id },
    attributes: ["id", "start", "end", "dietitionLink"],
    include: [{ model: TimeDietition, attributes: ["id", "day"] }],
    order: [["id", "ASC"]],
  });

  const data = slots.map((slot) => ({
    id: slot.id,
    day: slot.TimeDietition ? slot.TimeDietition.day : null,
    start: slot.start,
    end: slot.end,
    dietitionLink: slot.dietitionLink || "",
  }));

  const response = ApiResponse("1", "Slots fetched successfully", data);
  return res.json(response);
}

// Lists the logged-in dietitian's own upcoming CONFIRMED consultations
// (real bookings, not the recurring SlotDiet templates) — this is what
// backs the "Start This Session" button in the link tool page. Only
// confirmed ones show up here: pending hasn't been accepted yet,
// In Progress/completed/canceled aren't startable.
async function getMyUpcomingConsultations(req, res) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const appointments = await Appointment.findAll({
    where: {
      dietitionId: req.user.id,
      status: "confirmed",
      date: { [Op.gte]: todayStart },
    },
    include: [
      { model: User, as: "ClientUser", attributes: ["id", "firstName", "lastName"] },
      { model: SlotDiet, attributes: ["id", "start", "end"] },
    ],
    order: [["date", "ASC"]],
    limit: 15,
  });

  const data = appointments.map((appt) => {
    const client = appt.ClientUser;
    return {
      id: appt.id,
      date: appt.date,
      start: appt.SlotDiet ? appt.SlotDiet.start : null,
      end: appt.SlotDiet ? appt.SlotDiet.end : null,
      clientName: client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : "Client",
    };
  });

  const response = ApiResponse("1", "Consultations fetched successfully", data);
  return res.json(response);
}
async function userHome(req, res) {
  try {
    const { userId, code } = req.params;

    // Fetch basic user data
    const userData = await User.findOne({
      where: { id: userId },
      attributes: ["id", "freeze", "usedFreezeOption", "customSupporter"],
    });
    let country = await Countries.findOne({
      where: { name: code },
      attributes: ["id", "currency"],
    });

    if (!country) {
      country = await Countries.findOne({
        where: { id: 8 },
        attributes: ["id", "currency"],
      });
    }
    // Fetch custom supporter data if exists
    const customSupporterData = userData?.customSupporter
      ? await User.findOne({
        where: { id: userData.customSupporter },
        attributes: ["id", "firstName", "lastName", "email","phone"],
      })
      : null;

    // Fetch user plans and associated plans
    const plans = await UserPlan.findAll({
      where: { userId: userId },
      attributes: ["id", "buyingDate", "expireDate", "durationIdPlan", "price"],
      include: {
        model: Plan,
        attributes: [
          "id",
          "title",
          "shortDescription",
          "longDescription",
          "CategoryId",
        ],
      },
    });

    const testimonials = await Testimonial.findAll({
      where: { status: 1 },
      attributes: ["id", "image"],
    });

    // Calculate date differences correctly
    let planData = await Promise.all(
      plans.map(async (plan) => {
        const buyingDate = new Date(plan?.buyingDate);
        const expireDate = new Date(plan?.expireDate);
        const currentDate = new Date();

        // Convert dates to UTC for accurate calculation
        const differenceInMs =
          Date.UTC(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate()
          ) -
          Date.UTC(
            buyingDate.getFullYear(),
            buyingDate.getMonth(),
            buyingDate.getDate()
          );

        const spendDays = Math.floor(differenceInMs / (1000 * 60 * 60 * 24));

        const remaining =
          Date.UTC(
            expireDate.getFullYear(),
            expireDate.getMonth(),
            expireDate.getDate()
          ) -
          Date.UTC(
            currentDate.getFullYear(),
            currentDate.getMonth(),
            currentDate.getDate()
          );

        const remainingDays = Math.floor(remaining / (1000 * 60 * 60 * 24));

        if (remainingDays <= 0 && plan?.Plan?.title === "Free Trial") {
          // Bug D fix: userData was fetched without 'status' in attributes, so
          // setting userData.status then calling save() is a fragile partial save.
          // Use a targeted UPDATE that only touches the status column.
          await User.update({ status: false }, { where: { id: userId } });

          // Bug E fix: previously used planId (the Plan template's PK) which would
          // delete ALL UserPlan rows for this user with that template — e.g. if
          // they somehow had two Free Trial rows. Use the specific UserPlan row ID.
          await UserPlan.destroy({
            where: { id: plan.id },
          });

          const freeTrail = await FreeTrailUsers.findOne({ where: { freeTrialUser: userId } });

          if (freeTrail) {
            // Bug D fix: replaced serial for...of slot.destroy() loop with a
            // single bulk destroy — one DB round-trip instead of N, and atomic.
            await FreeTrailUsersSlots.destroy({
              where: { freeTrialUserId: freeTrail.id },
            });
            await freeTrail.destroy();
          }
          return;

        }

        // Fetch dietitian details asynchronously
        let dietitionDetails = plan.dietitianId
          ? await User.findOne({
            where: { id: plan.dietitianId },
            attributes: ["id", "firstName", "lastName", "email"],
          })
          : null;

        // const priceData = await Price.findOne({
        // where: { planId: plan?.Plan?.id },
        // attributes: ["id", "priceAmount"],
        // });

        //let priceData = null;


        // if (plan?.Plan?.id && plan?.durationIdPlan) {
        //   priceData = await Price.findOne({
        //     where: {
        //       planId: plan.Plan.id,
        //       durationId: plan.durationIdPlan,
        //     },
        //     attributes: ["id", "priceAmount"],
        //   });
        // }

        return {
          planId: plan?.Plan?.id,
          spendDays: spendDays,
          currency: country.currency,
          remainingDays: remainingDays,
          price: plan?.price,
          title: plan?.Plan?.title,
          dietitionLink: plan?.dietitionLink,
          shortDescription: plan?.Plan?.shortDescription,
          longDescription: plan?.Plan?.longDescription,
          usedFreezeOption: plan?.usedFreezeOption,
          dietitionDetails: dietitionDetails,
          CategoryId: plan?.Plan?.CategoryId,
          buyingDate: plan?.buyingDate,
          expireDate: plan?.expireDate,
          //  priceData
        };
      })
    );

    // // Now, handle removing the "Free Trial" plan

    // filter(Boolean) removes both null and undefined — the mapper can return either
    planData = planData.filter(Boolean);


    // const freeTrialPlan = plans.find((plan) => plan?.Plan?.title === "Free Trial");
    // const otherPlansExist = plans.some((plan) => plan?.Plan?.title !== "Free Trial");

    // // Debugging: Check if "Free Trial" exists and whether the user has other plans
    // console.log('Free Trial Plan:', freeTrialPlan);
    // console.log('Other plans exist:', otherPlansExist);

    // // If the user has a "Free Trial" plan and either no other plans or other plans as well, remove it
    // if (freeTrialPlan) {
    //   // Condition 1: User has only "Free Trial" and it's not expired
    //   if (
    //     otherPlansExist === false && // User has only "Free Trial"
    //     new Date(freeTrialPlan.expireDate) > new Date() // The "Free Trial" is still valid (not expired)
    //   ) {
    //     console.log("Removing Free Trial plan because it's the only plan and not expired.");

    //     // Remove "Free Trial" plan from the list of plans
    //     planData = planData.filter((plan) => plan.title !== "Free Trial");

    //     // Optionally: Remove "Free Trial" plan from the UserPlan table
    // await UserPlan.destroy({
    //   where: {
    //     userId: userId,
    //     planId: freeTrialPlan.Plan.id, // Use the correct plan ID for "Free Trial"
    //   },
    // });

    //     console.log(`Removed "Free Trial" plan from UserPlan for user with ID: ${userId}`);
    //   }

    //   // Condition 2: User has both "Free Trial" and other plans, remove "Free Trial"
    //   if (otherPlansExist) {
    //     console.log("Removing Free Trial plan because user has other plans.");

    //     // Remove "Free Trial" plan from the list of plans
    //     planData = planData.filter((plan) => plan.title !== "Free Trial");

    //     // Optionally: Remove "Free Trial" plan from UserPlan table
    //     await UserPlan.destroy({
    //       where: {
    //         userId: userId,
    //         planId: freeTrialPlan.Plan.id, // Use the correct plan ID for "Free Trial"
    //       },
    //     });

    //     console.log(`Removed "Free Trial" plan from UserPlan for user with ID: ${userId}`);
    //   }
    // }

    // Prepare response data
    const data = {
      userData,
      freeze: userData?.freeze ? 1 : 0,
      plans: planData,
      testimonial: testimonials,
      customSupporterData,
    };

    const response = ApiResponse("1", "User Home data", data);
    return res.json(response);
  } catch (error) {
    console.error(error);
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}


// async function userHome(req, res) {
//   try {
//     const { userId } = req.params;
//     let userData = await User.findOne({
//       where: { id: userId },
//       attributes: ["id", "freeze"],
//     });

//     // Fetch all plans for the user
//     const plans = await UserPlan.findAll({
//       where: { userId: userId },
//       attributes: [
//         "id",
//         "buyingDate",
//         "expireDate",
//         "price",
//         "dietitionLink",
//         "dietitianId",
//       ],
//       include: {
//         model: Plan,
//         attributes: [
//           "id",
//           "title",
//           "shortDescription",
//           "longDescription",
//           "CategoryId",
//         ],
//         include: {
//           model: Time,
//           attributes: ["id", "day"],
//           include: {
//             model: Slot,
//             attributes: ["id", "start", "end", "trainerLink"],
//           },
//         },
//       },
//     });

//     const test = await Testimonial.findAll({
//       where: { status: 1 },
//       attributes: ["id", "image"],
//     });

//     let planData = plans.map(plan => {
//       const buyingDate = new Date(plan?.buyingDate);
//       const expireDate = new Date(plan?.expireDate);
//       const currentDate = new Date();

//       const differenceInMs = currentDate - buyingDate;
//       const spendDays = Math.floor(differenceInMs / (1000 * 60 * 60 * 24));

//       const remaining = expireDate - currentDate;
//       const remainingDays = Math.floor(remaining / (1000 * 60 * 60 * 24));

//       let dietitionDetails = plan.dietitianId ?
//         User.findOne({
//           where: { id: plan.dietitianId },
//           attributes: ["id", "firstName", "lastName", "email"],
//         }) : null;

//       return {
//         spendDays: spendDays,
//         remainingDays: remainingDays,
//         price: plan?.price,
//         title: plan?.Plan?.title,
//         dietitionLink: plan?.dietitionLink,
//         shortDescription: plan?.Plan?.shortDescription,
//         longDescription: plan?.Plan?.longDescription,
//         Time: plan?.Plan?.Times,
//         dietitionDetails: dietitionDetails,
//         CategoryId: plan?.Plan?.CategoryId,
//       };
//     });

//     let data = {
//       userData: userData,
//       freeze: userData?.freeze ? 1 : 0,
//       plans: planData,
//       testimonial: test,
//     };

//     const response = ApiResponse("1", "User Home data", data);
//     return res.json(response);
//   } catch (error) {
//     const response = ApiResponse("0", error.message, {});
//     return res.json(response);
//   }
// }

async function addReport(req, res) {
  const {
    weight,
    currentWeight,
    arms,
    chest,
    abdoman,
    shoulder,
    thighs,
    userId,
    hips,
    istDayDate,
    currentDate,
    weist,
    review,
    aboutService,
  } = req.body;
  const report = new Report();
  report.weight = weight;
  report.currentWeight = currentWeight;
  report.arms = arms;
  report.chest = chest;
  report.abdoman = abdoman;
  report.weist = weist;
  report.shoulder = shoulder;
  report.thighs = thighs;
  report.hips = hips;
  report.istDayDate = istDayDate;
  report.status = 1;
  report.userId = userId;
  report.currentDate = currentDate;
  report.review = review;
  report.aboutService = aboutService;

  report
    .save()
    .then((dat) => {
      const response = ApiResponse("1", "Report added successfully", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}

async function userReports(req, res) {
  const reports = await User.findAll({
    where: { userType: "User" },
    attributes: ["id", "firstName", "lastName", "email", "phone"],
    include: { model: Report },
  });

  let data = {
    reports,
  };
  const response = ApiResponse("1", "Reports", data);
  return res.json(response);
}

async function getAnnouncement(req, res) {
  let data = await Announcement.findAll({});
  let response = ApiResponse("1", "Announcement Data", { data });
  return res.json(response);
}

// Cancels an active paid subscription (UserPlan) — the only "cancel"
// action that existed before this was cancelDietPlan, which only touches
// the DietPlan review document, never the underlying paid plan. There was
// no way to actually end someone's subscription server-side at all.
//
// Locked inside a transaction so a duplicate click (retry, admin
// double-tap) can't race a concurrent freeze/renewal on the same row or
// double-cancel it — the same TOCTOU class of bug flagged elsewhere in the
// payment/plan-approval flows, fixed here from the start rather than
// copied from the older unlocked pattern in freeze() below.
//
// IMPORTANT — what actually gates the app's paid/unpaid home screen is
// User.status (see AuthController.isPaid / logInUser.status on the
// Flutter side, and freeTrialExpiry.js for the equivalent free-trial
// flip), NOT UserPlan.status. An earlier version of this function only
// set UserPlan.status=false, which silently did NOT revoke in-app paid
// access — a cancelled subscriber kept seeing the full paid app until
// their next cold login. Fixed here: we flip User.status=false too,
// unless the user has another still-active plan (rare, but possible if
// an admin ever double-assigns a plan). UserPlan.status is deliberately
// LEFT ALONE (matches autoExpireUserPlans.js's existing convention for
// natural expiry) so the cancelled row keeps showing via
// GET /users/get_user_plans — the app needs it to explain what
// happened, rather than the plan silently vanishing.
async function cancelUserPlan(req, res) {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const result = await db.transaction(async (t) => {
      const plan = await UserPlan.findOne({
        where: { id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!plan) return { outcome: "not_found" };
      if (plan.planStatus === "cancelled") return { outcome: "already_cancelled" };

      plan.planStatus = "cancelled";
      plan.cancelledAt = new Date();
      plan.cancelReason = reason || null;
      plan.cancelledBy = (req.user && req.user.id) || null;
      await plan.save({ transaction: t });

      // Revoke in-app paid access — but only if this was their only
      // active plan. An "active" plan here mirrors getActivePlan() in
      // planFreezeController.js: not cancelled, not yet expired.
      //
      // BUG FIX: `{ [Op.ne]: "cancelled" }` alone compiles to SQL
      // `planStatus <> 'cancelled'`, which evaluates to NULL (not true)
      // when planStatus IS NULL — silently excluding every ordinary
      // never-touched plan (the vast majority in production) from ever
      // counting as "other active plan". Must allow NULL through
      // explicitly, same fix as getActivePlan() in planFreezeController.js.
      const otherActivePlan = await UserPlan.findOne({
        where: {
          userId: plan.userId,
          id: { [Op.ne]: plan.id },
          [Op.or]: [
            { planStatus: null },
            { planStatus: { [Op.ne]: "cancelled" } },
          ],
          expireDate: { [Op.gt]: new Date() },
        },
        transaction: t,
      });
      if (!otherActivePlan) {
        await User.update(
          { status: false },
          { where: { id: plan.userId }, transaction: t }
        );
      }

      return { outcome: "cancelled", planId: plan.id };
    });

    if (result.outcome === "not_found") {
      return res.json(ApiResponse("0", "Subscription not found", {}));
    }
    if (result.outcome === "already_cancelled") {
      return res.json(ApiResponse("0", "This subscription is already cancelled", {}));
    }

    return res.json(
      ApiResponse("1", "Subscription cancelled", { userPlanId: result.planId })
    );
  } catch (e) {
    console.error("cancelUserPlan error:", e);
    return res.json(
      ApiResponse("0", "Something went wrong while cancelling the subscription", {})
    );
  }
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

async function addReview(req, res) {
  const { comment, value, PlanId, userId, classReview, trainerOrDiet } = req.body;
  let rating = new Review();
  rating.comment = comment;
  rating.value = value;
  rating.PlanId = PlanId;
  rating.userId = userId;
  rating.classReview = classReview;
  rating.trainerOrDiet = trainerOrDiet;


  rating.status = 1;
  rating
    .save()
    .then((dat) => {
      let response = ApiResponse("1", "Thank you for your feedback", {});
      return res.json(response);
    })
    .catch((error) => {
      let response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}

async function getReviews(req, res) {
  let ratings = await Review({});
  return res.json(ratings);
}

async function syncrhonize(req, res) {
  try {
    const today = new Date();
    const thresholdDate = new Date();
    thresholdDate.setDate(today.getDate() + 5); // 5 days from now

    const userPlans = await UserPlan.findAll({
      attributes: ["expireDate"],
      where: {
        expireDate: {
          [sequelize.Op.between]: [today, thresholdDate], // Between today and 5 days from now
        },
      },
      include: [{ model: User, attributes: ["deviceToken"] }],
    });
    const deviceTokens = userPlans.map((userPlan) =>
      userPlan.User ? userPlan.User.deviceToken : null
    );

    // Remove null values
    const validDeviceTokens = deviceTokens.filter(
      (deviceToken) => deviceToken !== null
    );
    let notiData = {
      title: "Plan expiring soon",
      body: "Your Plan is about to expire",
    };
    sendNotification(validDeviceTokens, notiData, { type: "planExpiring" });
    let response = ApiResponse("1", "DAta", {});
    return res.json(response);
  } catch (error) {
    return res.json(ApiResponse("0", error.message, {}));
  }
}

async function guestLogin(req, res) {
  const { email, phone, name, result } = req.body;
  let guest = new Guest();
  guest.email = email;
  guest.phone = phone;
  guest.name = name;
  guest.result = result;
  guest
    .save()
    .then((dat) => {
      let response = ApiResponse("1", "Guest login", {});
      return res.json(response);
    })
    .catch((error) => {
      let response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}

async function getGuest(req, res) {
  try {
    let data = await User.findAll({
      where: {
        bmiResult: { [Op.ne]: null } // Ensures bmiResult is not null
      }
    });

    let response = ApiResponse("1", "Data retrieved successfully", { data });
    return res.json(response);
  } catch (error) {
    console.error("Error fetching guest data:", error);
    return res.status(200).json(ApiResponse("0", "Nothing Found", {}));
  }
}

async function payment(req, res) {
  const { planId, amount } = req.body;
  let planData = await Plan.findOne({ where: { id: planId } });
  // return res.json(planData);
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: planData.title,
            },
            unit_amount: parseInt(amount) * 100,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `https://backend.thefither.com/admin/payment_success`,
      cancel_url: `https://backend.thefither.com/admin/payment_failed`,
    });

    let response = ApiResponse("1", "Pyament Link", { session });
    return res.json(response);
  } catch (error) {
    let response = ApiResponse("0", error.message, {});
    return res.json(response);
    res.status(500).send({ error: error.message });
  }
}
async function payment_success(req, res) {
  const { userId, planId, dietitianId, trainerId, amount } = req.body;

  try {
    // Fetch the plan data
    let planData = await Plan.findOne({ where: { id: planId } });

    // Ensure planData and duration are defined
    if (!planData || !planData.duration) {
      let response = ApiResponse("0", "Plan data or duration not found", {});
      return res.status(404).json(response);
    }

    // Extract days from duration string
    const str = planData.duration;
    const match = str.match(/\d+/);
    if (!match) {
      let response = ApiResponse("0", "Invalid duration format", {});
      return res.status(400).json(response);
    }
    const days = parseInt(match[0], 10);

    // Fetch the user data
    let user = await User.findOne({ where: { id: userId } });

    if (!user) {
      let response = ApiResponse("0", "User not found", {});
      return res.status(404).json(response);
    }

    // Update user status
    user.status = true;
    await user.save();

    // Create and save new user plan
    let userPlan = new UserPlan();
    let now = new Date(); // Create a Date object
    userPlan.buyingDate = now;
    userPlan.expireDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    userPlan.price = planData?.price;
    userPlan.userId = userId;
    userPlan.PlanId = planId;
    userPlan.status = true;
    userPlan.trainerId = trainerId;
    // The Plan itself carries its own dietitianId (each package/SKU has
    // its dietitian baked in — set once on the Plan, not re-typed per
    // approval). Prefer that over whatever the admin request body sends,
    // falling back to the body value only if this Plan has no dietitian
    // configured (e.g. a workout-only plan, or a legacy plan predating
    // this field).
    userPlan.dietitianId =
      planData.dietitianId != null ? planData.dietitianId : dietitianId;
    await userPlan.save();

    // Generate response
    let response = ApiResponse("1", "Plan assigned successfully", { user });
    return res.json(response);
  } catch (error) {
    console.error(error);
    let response = ApiResponse("0", "Error assigning plan", {
      error: error.message,
    });
    return res.status(500).json(response);
  }
}

async function addImage(req, res) {
  try {
    const { planId, userId, durationId, price } = req.body;
    const uploadedImage = req.file;

    // Validate required fields
    if (!uploadedImage) {
      return res.status(200).json(ApiResponse("0", "No image uploaded.", {}));
    }

    if (!planId || !userId || !durationId || !price) {
      return res.status(200).json(ApiResponse("0", "Missing required fields.", {}));
    }

    // Check if user already uploaded an active image
    const existingImage = await PlanImage.findOne({
      where: { UserId: userId, status: true },
    });

    if (existingImage) {
      return res.status(200).json(
        ApiResponse("0", "You have already uploaded a picture. Please wait for admin approval.", {})
      );
    }

    // Normalize path (important for Windows compatibility)
    const imagePath = uploadedImage.path.replace(/\\/g, "/");

    // ─── Run OCR on the uploaded slip ───
    let ocrResult = null;
    try {
      ocrResult = await extractSlipData(imagePath, { amount: parseInt(price, 10) });
    } catch (err) {
      console.warn('OCR failed (non-fatal) in addImage:', err.message);
    }

    // ─── Duplicate detection — has this transaction ref ever been used? ───
    if (ocrResult?.refNumber) {
      const dup = await PlanImage.findOne({
        attributes: ['id', 'UserId', 'createdAt'],
        where: { ocrTransactionId: ocrResult.refNumber },
      });
      if (dup) {
        console.warn(`⚠️ Duplicate transaction ID in addImage: ${ocrResult.refNumber} already used by PlanImage id=${dup.id}`);
        return res.status(200).json(ApiResponse('0',
          'This payment slip has already been used. Each transaction can only be redeemed once. Contact support if you believe this is an error.',
          { duplicateOf: dup.id }
        ));
      }
    }

    // ─── Decide auto-approve vs admin queue ───
    let autoApproved = false;
    let approvalReason = null;
    const expectedAmount = parseInt(price, 10);
    const wrongReceiver = ocrResult?.receiver && !ocrResult?.receiverVerified;

    if (ocrResult && ocrResult.confidence >= OCR_AUTO_APPROVE_MIN_CONFIDENCE && !wrongReceiver) {
      const receiverTag = ocrResult.receiverVerified ? `, receiver verified (${ocrResult.receiver})` : '';
      if (ocrResult.amount &&
          Math.abs(ocrResult.amount - expectedAmount) <= OCR_AMOUNT_TOLERANCE_PKR) {
        autoApproved = true;
        approvalReason = `OCR confidence ${(ocrResult.confidence * 100).toFixed(0)}% — amount + bank verified${receiverTag}`;
      } else if (ocrResult.amount && ocrResult.amount > expectedAmount) {
        autoApproved = true;
        approvalReason = `OCR confidence ${(ocrResult.confidence * 100).toFixed(0)}% — customer paid more (PKR ${ocrResult.amount}), credit forward${receiverTag}`;
      }
    } else if (wrongReceiver) {
      approvalReason = `Slip receiver is "${ocrResult.receiver}" (expected FitHer or Shaista Khalid) — admin review required`;
    }

    // Create the PlanImage row
    const newImage = new PlanImage();
    newImage.PlanId           = planId;
    newImage.UserId           = userId;
    newImage.image            = imagePath;
    newImage.PriceDurationId  = durationId;
    newImage.status           = true;
    newImage.price            = price;
    // Extended fields
    newImage.paidAmount       = ocrResult?.amount && autoApproved ? ocrResult.amount : expectedAmount;
    newImage.uploadSource     = 'user_app';
    newImage.ocrData          = ocrResult ? {
      amount:           ocrResult.amount,
      amounts:          ocrResult.amounts,
      date:             ocrResult.date,
      bank:             ocrResult.bank,
      sender:           ocrResult.sender,
      receiver:         ocrResult.receiver,
      receiverVerified: ocrResult.receiverVerified,
      refNumber:        ocrResult.refNumber,
      rawText:          ocrResult.rawText?.slice(0, 1000),
      autoApproved,
      approvalReason,
    } : null;
    newImage.ocrConfidence    = ocrResult?.confidence || null;
    newImage.ocrAmount        = ocrResult?.amount     || null;
    newImage.ocrBank          = ocrResult?.bank       || null;
    newImage.ocrDate          = ocrResult?.date       || null;
    newImage.ocrSender        = ocrResult?.sender     || null;
    newImage.ocrReceiver      = ocrResult?.receiver   || null;
    newImage.ocrTransactionId = ocrResult?.refNumber  || null;

    await newImage.save();

    // End-of-trial offer: if this slip is for a plan + duration in her
    // live trial offer at the offer price, record the discount on the
    // slip (listPrice / discountAmount / discountReason) so admins see
    // why the amount is lower, and mark the offer used.
    try {
      const { applyOfferToSlip } = require("../../helper/trialOffer");
      const matched = await applyOfferToSlip({
        userId, planId, durationId, price, planImage: newImage,
      });
      if (matched) await newImage.save();
    } catch (e) {
      console.warn("Trial offer check failed (non-fatal):", e.message);
    }

    // ─── Auto-activate the plan if OCR auto-approved it ───
    let activationResult = null;
    if (autoApproved) {
      try {
        activationResult = await applyPlanApproval(newImage, { approvalSource: 'auto' });
        if (!activationResult.ok) {
          console.warn('Auto-activation failed in addImage, falling back to admin:', activationResult.error);
          autoApproved = false;
          approvalReason = `Auto-approve failed: ${activationResult.error} — admin review required`;
        }
      } catch (err) {
        console.error('Auto-activation error in addImage:', err);
        autoApproved = false;
      }
    }

    // ─── Notify admin only if NOT auto-approved (no need to bother admin when system handled it) ───
    if (!autoApproved) {
      const admin = await User.findOne({ where: { userType: "Admin" } });
      if (admin?.deviceToken) {
        const notification = {
          title: "Approve Request",
          body: "A new user image request has been received.",
        };
        await sendNotification([admin.deviceToken], notification, { type: "paymentApprovalRequest" });
      }
    }

    // ─── User-facing response — different message based on outcome ───
    const userMessage = autoApproved
      ? 'Payment verified — your plan is now active!'
      : 'Payment slip received. Our team is verifying and you will be notified shortly.';

    return res.status(200).json(ApiResponse("1", userMessage, {
      autoApproved,
      verificationStatus: autoApproved ? 'verified' : 'pending_review',
      userPlanActivated:  !!activationResult?.ok,
      userPlanId:         activationResult?.userPlanId || null,
      planImageId:        newImage.id,
      ocrSummary: ocrResult ? {
        confidence:       ocrResult.confidence,
        amount:           ocrResult.amount,
        bank:             ocrResult.bank,
        date:             ocrResult.date,
        receiver:         ocrResult.receiver,
        receiverVerified: ocrResult.receiverVerified,
        refNumber:        ocrResult.refNumber,
      } : null,
    }));

  } catch (error) {
    console.error("Error in addImage:", error);
    return res.status(200).json(ApiResponse("0", "Internal server error", { error: error.message }));
  }
}



async function getAllPlanImages(req, res) {
  try {
    const data = await PlanImage.findAll({
      where: { status: true },
      order: [['createdAt', 'DESC']], // Order by createdAt descending
      attributes: ["id", "image"],
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email", "phone", "customSupporter"],
          include: [
            {
              model: User,
              as: 'supporter',
              attributes: ["id", "firstName", "lastName", "email"]
            }
          ]
        },
        {
          model: Plan,
          attributes: ["id", "title", "shortDescription", "longDescription"]
        },
        {
          model: PriceDurations,
          attributes: ["id", "duration"]
        }
      ]
    });

    return res.json(ApiResponse("1", "Plan Images", { data }));
  } catch (error) {
    console.error("Error fetching plan images:", error);
    return res.status(200).json(ApiResponse("0", "Something went wrong", {}));
  }
}




async function approvedImage(req, res) {
  const { planImageId, rejected } = req.body;
// Inside the approval section (replace the existing UserPlan creation part):

try {
  let image = await PlanImage.findOne({
    where: { id: planImageId },
    include: [
      { model: User, attributes: ["id", "firstName", "lastName", "email", "deviceToken"] },
      { model: Plan, attributes: ["id", "title", "shortDescription", "longDescription"] },
      { model: PriceDurations, attributes: ["id", "duration"] },
    ],
  });
 const user=await User.findOne({
      where: { id: image?.UserId},
    });

  if (rejected) {
    await image.destroy();

    if (user?.deviceToken) {
      let rejectionNotification = {
        title: "Request Rejected",
        body: "Sorry, your plan request has been rejected.",
      };
      sendNotification([user.deviceToken], rejectionNotification, { type: "paymentRejected" });
    }

    return res.json(ApiResponse("1", "Plan image rejected and notification sent to User", {}));
  }
  const str = image?.PriceDuration?.duration || "30 days";
  const newPlanDays = parseInt(str.match(/\d+/)[0], 10);
  const now = new Date();

  // Check if user already has the same active plan
  let existingPlan = await UserPlan.findOne({
    where: {
      userId: image.UserId,
      PlanId: image.PlanId,
      expireDate: { [Op.gte]: now }, // Active plan
      status: true,
    },
  });

  if (existingPlan) {
    // Calculate remaining days of existing plan
    const remainingTime = existingPlan.expireDate.getTime() - now.getTime();
    const remainingDays = Math.ceil(remainingTime / (1000 * 60 * 60 * 24));

    // Extend the plan by adding remaining + new days
    const totalDays = remainingDays + newPlanDays;
    existingPlan.expireDate = new Date(now.getTime() + totalDays * 24 * 60 * 60 * 1000);
    existingPlan.buyingDate = now;
    existingPlan.price = image.price;
    existingPlan.durationIdPlan = image?.PriceDuration?.id;

    await existingPlan.save();
  } else {
    // No existing plan, create new one
    await UserPlan.create({
      buyingDate: now,
      expireDate: new Date(now.getTime() + newPlanDays * 24 * 60 * 60 * 1000),
      userId: image.UserId,
      PlanId: image.PlanId,
      price: image.price,
      durationIdPlan: image?.PriceDuration?.id,
      status: true,
    });
  }

  image.status = 0;
  await image.save();

  // Remove expired plans
  const expiredPlans = await UserPlan.findAll({
    where: {
      userId: image.UserId,
      expireDate: { [Op.lt]: now },
      status: true,
    },
  });

  for (const plan of expiredPlans) {
    await plan.destroy();
  }

  // Update user status
  if (user) {
    user.status = true;
    await user.save();
  }

  // Remove free trial if it exists
  let freePlan = await Plan.findOne({ where: { title: "Free Trial" } });
  if (freePlan) {
    let dd = await UserPlan.findOne({
      where: { UserId: image.UserId, PlanId: freePlan.id },
    });
    if (dd) {
      await dd.destroy();
    }
  }

  if (user?.deviceToken) {
    let approvalNotification = {
      title: "Congratulations!",
      body: "Your package has been approved. Enjoy the best services.",
    };
    sendNotification([user.deviceToken], approvalNotification, { type: "paymentApproved" });
  }

  return res.json(ApiResponse("1", "Plan approved and assigned to user", {}));
} catch (error) {
  console.error("Error saving user plan:", error);
  return res.status(200).json(ApiResponse("0", error.message, { error: error.message }));
}

}


async function sendNotification_to_all_users(req, res) {
  let { title, body } = req.body;

  try {
    // Retrieve users with status true and their device tokens
    let users = await User.findAll({
      attributes: ["deviceToken"],
    });

    // Extract device tokens and store them in an array
    let deviceTokens = users.map((user) => user.deviceToken);
    const validDeviceTokens = deviceTokens.filter(
      (deviceToken) => deviceToken !== null
    );

    // Define the notification body
    let notification = {
      title: title,
      body: body,
    };

    // Send notification
    sendNotification(validDeviceTokens, notification, { type: "announcement" });

    // Create and send response
    let response = ApiResponse("1", "Notification sent successfully", {});
    return res.json(response);
  } catch (error) {
    console.error("Error sending notification:", error);
    let response = ApiResponse("0", error.message, {});
    return res.status(500).json(response);
  }
}

async function get_subcategories_based_on_user_types(req, res) {
  var { userType } = req.params;
  if (userType === process.env.DIETITION) {
    userType = "Diet";
  }
  if (userType === process.env.TRAINER) {
    userType = "Workout";
  }
  if (userType === process.env.GYNECOLOGIST) {
    userType = "Gynaecologist";
  }

  try {
    // Fetch subcategories where the title of the associated category matches the userType using LIKE
    let data = await SubCategory.findAll({
      where: { status: true },
      attributes: ["id", "title"],
      include: {
        model: Category,
        attributes: [],
        where: {
          title: {
            [Op.like]: `%${userType}%`, // Searching for title similar to userType
          },
        },
      },
    });

    // Creating a response with a custom API response function
    let response = ApiResponse("1", "Data", { data });
    return res.json(response);
  } catch (error) {
    // Handle errors and send an appropriate response
    let response = ApiResponse("0", "Error", { error: error.message });
    return res.status(500).json(response);
  }
}

async function get_plans_based_on_sub_categories(req, res) {
  const { subCategoryId } = req.params;
  let data = await Plan.findAll({ where: { subCategoryId: subCategoryId } });
  let response = ApiResponse("1", "Data", { plans: data });
  return res.json(response);
}

async function get_users_based_on_types(req, res) {
  const { userType } = req.params;
  const data = await User.findAll({
    where: { userType: userType },
    attributes: [
      "id",
      "firstName",
      "lastName",
      "email",
      "phone",
      "speciality",
      "totalPatients",
      "experience",
      "image",
      "description",
    ],
  });
  let response = ApiResponse("1", "Users Data", { users: data });
  return res.json(response);
}

async function workout_plans(req, res) {
  try {
    let workout = await Category.findOne({
      where: { title: "Workout and Diet" },
    });
    if (workout) {
      let plans = await Plan.findAll({
        include: {
          model: SubCategory,
          attributes: [],
          where: { CategoryId: workout.id },
        },
        attributes: [
          "id",
          "title",
          "price",
          "shortDescription",
          "longDescription",
          "duration",
          "status",
          "image",
          "CategoryId",
          "subCategoryId",
        ],
      });
      let response = ApiResponse("1", "Workout and diet plans", { plans });
      return res.json(response);
    }
  } catch (error) {
    let response = ApiResponse("0", "Error", { error: error.message });
    return res.status(500).json(response);
  }
}
async function user_workout_plans(req, res) {
  try {
    const { userId } = req.params;
    // Category lookups are the legacy path — kept as a fallback, not
    // required. planType is the authoritative signal going forward (see
    // migration 20260902000001-add-plan-type-to-plans); this OR keeps
    // working unchanged before the catalog is backfilled and switches
    // to the reliable field automatically as plans get labeled, with no
    // second deploy needed. "combined" plans count as workout plans too
    // (mirrors the historical "Both" category behavior below).
    let workout = await Category.findOne({ where: { title: "Workout" } });
    let both = await Category.findOne({ where: { title: "Both" } });
    const categoryIds = [workout, both].filter(Boolean).map((c) => c.id);

    const or = [{ planType: { [Op.in]: ["workout", "combined"] } }];
    if (categoryIds.length > 0) or.push({ CategoryId: { [Op.in]: categoryIds } });

    let plans = await Plan.findAll({
      include: [
        {
          model: UserPlan,
          attributes: [],
          where: { UserId: userId },
          required: true,
        },
      ],
      attributes: [
        "id",
        "title",
        "shortDescription",
        "longDescription",
        "status",
        "image",
        "CategoryId",
        "subCategoryId",
        "planType",
      ],
      where: { [Op.or]: or },
    });

    let response = ApiResponse("1", "Workout and diet plans", { plans });
    return res.json(response);
  } catch (error) {
    let response = ApiResponse("0", "Error", { error: error.message });
    return res.status(500).json(response);
  }
}

async function assign_workout_diet_plan(req, res) {
  const { planId, dietitianId, trainerId } = req.body;
  let assigned = new AssignedPlan();
  assigned.PlanId = planId;
  assigned.dietitianId = dietitianId;
  assigned.trainerId = trainerId;
  assigned.UserId = dietitianId;
  await assigned.save();

  let response = ApiResponse("1", "Assigned Successfully", {});
  return res.json(response);
}

async function dietition_add_plan(req, res) {
  const {
    title,
    shortDescription,
    longDescription,
    duration,
    price,
    subCategoryId,
  } = req.body;
  let check = await Plan.findOne({ where: { title: title } });
  if (check) {
    let response = ApiResponse("0", "Title already exists", {});
    return res.json(response);
  }

  let cat = await SubCategory.findOne({
    where: { id: subCategoryId },
    include: { model: Category },
  });

  let plan = new Plan();
  plan.title = title;
  plan.shortDescription = shortDescription;
  plan.longDescription = longDescription;
  plan.duration = duration;
  plan.price = price;
  plan.subCategoryId = subCategoryId;
  plan.CategoryId = cat.CategoryId;
  plan.status = 1;
  plan
    .save()
    .then(async (dat) => {
      let assigned = new AssignedPlan();
      assigned.PlanId = dat.id;
      assigned.UserId = req.user.id;
      await assigned.save();

      let response = ApiResponse("1", "Added successfully", {});
      return res.json(response);
    })
    .catch((error) => {
      let response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}

async function update_user(req, res) {
  const { userId, speciality, totalPatients, experience, description } =
    req.body;
  let user = await User.findOne({ where: { id: userId } });
  user.speciality = speciality;
  user.totalPatients = totalPatients;
  user.experience = experience;
  user.description = description;
  const service_image = req.file;
  let tmpPath = service_image.path;
  let imagePath = tmpPath.replace(/\\/g, "/");
  user.image = imagePath;
  await user.save();
  let response = ApiResponse("1", "Updated successfully", {});
  return res.json(response);
}

async function addDiet(req, res) {
  const { userId, userPlanId, diet } = req.body;
  console.log(`***********************  ${JSON.stringify(req.body)}`);

  try {
    // Find the UserPlan
    let userPlan = await UserPlan.findOne({ where: { id: userPlanId } });
    if (!userPlan) {
      return res.json(ApiResponse("0", "User Plan not found!", {}));
    }

    let dd = await DietTime.findAll({ where: { UserPlanId: userPlanId } });
    if (dd.length > 0) {
      for (const d of dd) {
        await Diet.destroy({ where: { DietTimeId: d.id } });
      }
    }

    // Destroy all previous Diet records associated with the UserPlanId
    await Diet.destroy({ where: { DietTimeId: userPlanId } });

    // Destroy all previous DietTime records associated with the UserPlanId
    await DietTime.destroy({ where: { UserPlanId: userPlanId } });

    // Iterate over each day's diet in the request
    for (const dayDiet of diet) {
      const { day, meals } = dayDiet;

      // Create a new DietTime record for the day
      const dietTime = await DietTime.create({
        day,
        UserPlanId: userPlanId,
        status: true,
      });

      // Iterate over meals for that day and create Diet records
      for (const meal of meals) {
        const { time, food, calories } = meal;

        await Diet.create({
          time,
          food,
          calories,
          DietTimeId: dietTime.id,
          status: true,
        });
      }
    }

    // Send a success response
    return res.json(ApiResponse("1", "Diet plan added successfully", {}));
  } catch (error) {
    console.error("Error adding diet plan:", error);
    return res.status(500).json(ApiResponse("0", "Error adding diet plan", {}));
  }
}

async function dietitionPlans(req, res) {
  const { id } = req.params;
  let data = await AssignedPlan.findAll({
    attributes: [],
    where: { UserId: id },
    include: { model: Plan },
  });
  return res.json(ApiResponse("1", "Data", { data }));
}

async function userDietPlans(req, res) {
  try {
    const { userId } = req.params;

    // Category lookups are the legacy path — kept as a fallback, not
    // required (previously this whole endpoint 404'd if either lookup
    // failed, which meant a single naming mismatch broke it outright).
    // planType is the authoritative signal going forward (migration
    // 20260902000001-add-plan-type-to-plans). "combined" plans count as
    // diet plans too, mirroring the historical "Both" category.
    let category = await Category.findOne({ where: { title: "Diet" } });
    let both = await Category.findOne({ where: { title: "Both" } });
    const categoryIds = [category, both].filter(Boolean).map((c) => c.id);

    const planOr = [{ planType: { [Op.in]: ["diet", "combined"] } }];
    if (categoryIds.length > 0) planOr.push({ CategoryId: { [Op.in]: categoryIds } });

    let userPlans = await UserPlan.findAll({
      where: { UserId: userId },
      include: [
        {
          model: Plan,
          attributes: ["title", "shortDescription", "longDescription", "planType"],
          where: { [Op.or]: planOr },
        },
      ],
    });

    return res.json(ApiResponse("1", "Data", { userPlans }));
  } catch (error) {
    return res
      .status(500)
      .json(ApiResponse("0", "Error", { error: error.message }));
  }
}

async function addProgressImages(req, res) {
  const { userId } = req.body;
  const beforeImage = req.files["before"] ? req.files["before"][0] : null;
  const afterImage = req.files["after"] ? req.files["after"][0] : null;
  let progress = new ProgressImage();
  progress.UserId = userId;
  progress.status = true;
  if (req.files["before"]) {
    const beforeImage = req.files["before"][0];
    let beforeImagePath = beforeImage.path.replace(/\\/g, "/");
    progress.before = beforeImagePath; // Store the path or filename in your model
  }

  // Handle after image
  if (req.files["after"]) {
    const afterImage = req.files["after"][0];
    let afterImagePath = afterImage.path.replace(/\\/g, "/");
    progress.after = afterImagePath; // Store the path or filename in your model
  }
  await progress.save();
  return res.json(ApiResponse("1", "Save successfully", {}));
}

async function getProgressImages(req, res) {
  const { userId } = req.params;
  let progress = await ProgressImage.findAll({ where: { UserId: userId } });
  let reviews = await Review.findAll({
    include: { model: User, attributes: ["id", "firstName", "lastName"] },
  });
  return res.json(ApiResponse("1", "Data", { progress, reviews }));
}


async function dietPlanDetails(req, res) {
  try {
    const { userPlanId } = req.params;

    // Validate input
    if (!userPlanId) {
      return res.json(ApiResponse("0", "Invalid userPlanId provided."));
    }

    // Fetch UserPlan details
    const userPlanDetails = await UserPlan.findOne({
      where: { id: userPlanId },
      attributes: ["id", "buyingDate", "expireDate", "PlanId", "userId"],
    });

    if (!userPlanDetails) {
      return res.json(
        ApiResponse("0", "No UserPlan found with the provided ID.")
      );
    }

    // Fetch Plan details
    const planDetails = await Plan.findOne({
      where: { id: userPlanDetails.PlanId },
      attributes: ["id", "title", "dietitianId"],
    });

    if (!planDetails) {
      return res.json(ApiResponse("0", "No Plan found for the UserPlan."));
    }

    // Check if an appointment exists for the user
    const appointAdded = await Appointment.findOne({
      where: {
        dietitionId: planDetails.dietitianId,
        userId: userPlanDetails.userId,
        planId: userPlanId,
             status: {
               [Op.notIn]: ['canceledByUser', 'canceled']
                 }
      },


    });
    let bookedSlot;
    let responseArray = [];
    //if (!appointAdded) {
      // Fetch available slots if no appointment exists.
      // isAvailble was dropped (migration 20260503130000) — it was a
      // dead column that was never written. Availability is determined
      // by the Appointment table (booked vs not), not a slot flag.
      const slots = await SlotDiet.findAll({
        where: { dietitionId: planDetails.dietitianId },
        attributes: ["id", "start", "end", "dietitionLink"],
        include: [
          {
            model: TimeDietition,
            attributes: ["id", "day"],
          },
        ],
      });

      // Group slots by TimeDietition
      const groupedSlots = slots.reduce((acc, slot) => {
        const timeDietition = slot.TimeDietition;
        if (!acc[timeDietition.id]) {
          acc[timeDietition.id] = {
            id: timeDietition.id,
            day: timeDietition.day,
            slots: [],
          };
        }
        acc[timeDietition.id].slots.push({
          id: slot.id,
          start: slot.start,
          end: slot.end,
          dietitionLink: slot.dietitionLink,
        });
        return acc;
      }, {});

      responseArray = Object.values(groupedSlots);
  //  }
if(appointAdded) {
     
      // isAvailble was dropped (migration 20260503130000) — same as above.
      bookedSlot = await SlotDiet.findOne({
        where: { id: appointAdded.timeSlotId },
        attributes: ["id", "start", "end", "dietitionLink"],
        include: [
          {
            model: TimeDietition,
            attributes: ["id", "day"],
          },
        ],
      });
    }

    // Fetch dietitian details
    const dietDetails = await User.findOne({
      where: { id: planDetails.dietitianId },
      attributes: ["id", "firstName", "lastName", "email", "experience","phone"],
    });

    if (!dietDetails) {
      return res.json(
        ApiResponse("0", "No dietitian details found for the plan.")
      );
    }

    // Construct response data
    const responseData = {
      isBooked: !!appointAdded,
      status: appointAdded?.status ?? null,
      id:appointAdded?.id ?? null,
	  date:appointAdded?.date,
      TimeDietition: responseArray,
      dietDetails: dietDetails,
      bookedSlot: bookedSlot

    };

    // Return success response
    return res.json(
      ApiResponse("1", "Details fetched successfully!", responseData)
    );
  } catch (error) {
    console.error("Error fetching diet plan details:", error);
    return res.json(
      ApiResponse("0", "An error occurred while fetching details.", {
        error: error.message,
      })
    );
  }
}



async function workout_plan_details(req, res) {
  const { id, userId, showSlots } = req.params;

  try {

     let slots = [];

    // Look up the user's timezone so slot times can be returned in their
    // local wall-clock. Falls back to the app's default tz if unset.
    let userTz = SLOT_DEFAULT_TZ;
    if (userId) {
      try {
        const u = await User.findOne({
          where: { id: userId },
          attributes: ["id", "timeZone"],
        });
        if (u && u.timeZone) userTz = u.timeZone;
      } catch (_) { /* ignore — fall back to default */ }
    }

    // ✅ If id is 0, return regular slots directly (skip plan check)
    if (id === "0") {
      slots = await Slot.findAll({
        where: {
          start: { [Op.ne]: "Start Time" },
          end: { [Op.ne]: "End Time" },
          trainerId: { [Op.ne]: null }
        },
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName", "email"]
          },
          {
            model: Time,
            attributes: ["id", "day"]
          }
        ]
      });

      return res.json(ApiResponse("1", "Regular slots", {
        trainerSlots: groupSlotsByLocalWeekday(slots, userTz),
        plan: null
      }));
    }

    const plan = await Plan.findOne({
      where: { id },
      attributes: ["id", "title", "shortDescription", "longDescription"]
    });

    if (!plan) {
      return res.status(200).json(ApiResponse("0", "Plan not found", {}));
    }


    // Find if this plan is a free trial plan
    if (plan.title === "Free Trial" && showSlots === "false") {
      const freeTrialData = await FreeTrailUsers.findOne({
        where: { freeTrialUser: userId },
        include: [
          {
            model: FreeTrailUsersSlots,
            as: "freeUserSlots",
            include: [
              {
                model: Slot,
                as: "slot",
                where: {
                  start: { [Op.ne]: "Start Time" },
                  end: { [Op.ne]: "End Time" },
                  trainerId: { [Op.ne]: null }
                },
                include: [
                  {
                    model: User,
                    attributes: ["id", "firstName", "lastName", "email"]
                  },
                  {
                    model: Time,
                    attributes: ["id", "day"]
                  }
                ]
              }
            ]
          }
        ]
      });

      if (
        freeTrialData &&
        freeTrialData.freeUserSlots &&
        Array.isArray(freeTrialData.freeUserSlots)
      ) {
        for (const slotItem of freeTrialData.freeUserSlots) {
          if (slotItem.slot) {
            slots.push(slotItem.slot);
          }
        }
      }
    } else {
      // Regular plan slots
      slots = await Slot.findAll({
        where: {
          start: { [Op.ne]: "Start Time" },
          end: { [Op.ne]: "End Time" },
          trainerId: { [Op.ne]: null }
        },
        include: [
          {
            model: User,
            attributes: ["id", "firstName", "lastName", "email"]
          },
          {
            model: Time,
            attributes: ["id", "day"]
          }
        ]
      });
    }

    return res.json(ApiResponse("1", "Details", {
      trainerSlots: groupSlotsByLocalWeekday(slots, userTz),
      plan: plan
    }));
  } catch (err) {
    console.error("❌ Error in workout_plan_details:", err);
    return res.status(200).json(ApiResponse("0", "Internal server error", {}));
  }
}


async function getTeamMember(req, res) {
  try {
    // Retrieve user types from environment variables
    const gynecologist = process.env.GYNECOLOGIST;
    const trainer = process.env.TRAINER;
    const psychiatrist = process.env.PSYCHIATRIST;
    const dietition = process.env.DIETITION;

    // Ensure that environment variables are set
    if (!gynecologist || !trainer || !psychiatrist || !dietition) {
      return res
        .status(500)
        .json(ApiResponse("0", "Environment variables are not set properly"));
    }

    // Find all users with userType matching any of the specified values using Op.in
    let data = await User.findAll({
      where: {
        userType: {
          [Op.in]: [gynecologist, trainer, psychiatrist, dietition],
        },
      },
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "phone",
        "image",
        "userType",
      ],
    });

    // Return response
    return res.json(ApiResponse("1", "Data", { data }));
  } catch (error) {
    // Handle any errors that occur during the query
    console.error("Error retrieving team members:", error);
    return res
      .status(500)
      .json(ApiResponse("0", "An error occurred while fetching data"));
  }
}

async function getFreePlan(req, res) {
  try {
    // Fetch the plan where the category title is 'Free Trial'
    const plan = await Plan.findOne({
      where: { title: "Free Trial" }, // Filter the category with 'Free Trial' title
    });

    // Return the response with the fetched plan
    return res.json(ApiResponse("1", "Data", plan));
  } catch (error) {
    console.error("Error fetching free plan:", error);

    // Handle errors
    return res.json(
      ApiResponse("0", "Error fetching free plan", { error: error.message })
    );
  }
}

// Toggles the active/inactive status of the Free Trial plan only.
// Safety guard: rejects if the resolved plan is not titled "Free Trial" so a
// wrong ID can never accidentally disable a paid plan.
async function changeFreeTrialStatus(req, res) {
  try {
    const { status, id } = req.body;

    const plan = await Plan.findOne({ where: { id } });
    if (!plan) {
      return res.json(ApiResponse("0", "Plan not found", {}));
    }

    // Safety: this endpoint must only ever touch the Free Trial plan.
    if (plan.title !== 'Free Trial') {
      console.warn(
        `[changeFreeTrialStatus] Rejected: planId=${id} is "${plan.title}", not "Free Trial"`
      );
      return res.json(ApiResponse("0", "This endpoint only manages the Free Trial plan", {}));
    }

    plan.status = status;
    await plan.save();
    return res.json(ApiResponse("1", "Status Updated!", { status }));
  } catch (error) {
    console.error('[changeFreeTrialStatus] error:', error.message);
    return res.json(ApiResponse("0", "Internal Server Error", {}));
  }
}

// Make sure to import Op if you're using Sequelize operators

async function addTip(req, res) {
  const { title, description, userId } = req.body;

  // Check if a health tip with the same title and userId already exists
  let check = await HealthTips.findOne({
    where: { title: title, UserId: userId }, // Fixed syntax here
  });

  if (check) {
    return res.json(ApiResponse("1", "Already exists", {}));
  }

  // Create a new HealthTip instance
  let tip = new HealthTips();
  tip.title = title;
  tip.description = description;
  tip.UserId = userId;

  // If there is a file uploaded, process the image
  if (req.file) {
    const service_image = req.file;
    let tmpPath = service_image.path;
    let imagePath = tmpPath.replace(/\\/g, "/");
    tip.image = imagePath;
  }

  // Save the new tip to the database
  await tip.save();
  return res.json(ApiResponse("1", "Added successfully", {}));
}
async function userCount(req, res) {
  try {
    // Get today's date range using Date object
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0); // Set to the start of the day

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999); // Set to the end of the day

    // Fetch users created today
    let users = await User.findAll({
      where: {
        userType: process.env.USER,
        createdAt: {
          [Op.between]: [todayStart, todayEnd], // Filter users created today
        },
      },
      attributes: ["id", "firstName", "lastName", "email", "createdAt"], // Added attributes
      include: {
        model: UserPlan,
        attributes: ["id"],
        include: {
          model: Plan,
          attributes: ["id", "title"],
          where: { title: { [Op.ne]: "Free Trial" } }, // Exclude plans with title "Free Trial"
        },
      },
    });

    // Separate users into two lists
    const userWithPlans = [];
    const userWithoutPlans = [];

    users.forEach((user) => {
      if (user.UserPlans && user.UserPlans.length > 0) {
        userWithPlans.push(user);
      } else {
        userWithoutPlans.push(user);
      }
    });

    let data = {
      userWithPlans,
      userWithoutPlans,
    };
    return res.json(ApiResponse("1", "Data", data));
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "An error occurred while fetching users" });
  }
}

async function completeDietPlan(req, res) {
  const { userPlanId } = req.body;
  let data = await UserPlan.findOne({ where: { id: userPlanId } });
  if (data) {
    // Diet-plan-review signal only — kept separate from planStatus,
    // which now belongs to the subscription/package lifecycle (see
    // migration 20260901000001-add-diet-plan-status-to-user-plans).
    data.dietPlanStatus = process.env.PLANSTATUS;
    await data.save();
  }
  return res.json(ApiResponse("1", "Status updated", {}));
}

async function addDietitionReview(req, res) {
  const { UserId, dietitianId, userPlanId, comment, value } = req.body;

  await UserReview.create({
    comment,
    value,
    //  dietitianId:dietitianId,
    // UserId:UserId
  });
  let data = await UserPlan.findOne({ where: { id: userPlanId } });
  if (data) {
    // Same diet-plan-review signal as completeDietPlan above — not the
    // subscription's planStatus.
    data.dietPlanStatus = process.env.PLANSTATUS;
    await data.save();
  }
  return res.json(ApiResponse("1", "Rating added successfully", {}));
}

async function getRating(req, res) {
  const { dietitianId } = req.params;
  // let rating = await UserReview.findAll({where:{dietitianId:dietitianId},include:{model:User,attributes:['id','firstName','lastName']}});
  return res.json(ApiResponse("1", "Rating", { "": "" }));
}

async function getAllCustomSupporters(req, res) {
  try {
    // Fetch users of type "User"
    const { userId } = req.params;
    const users = await User.findAll({
      where: { customSupporter: userId },
      attributes: [
        "id",
        "firstName",
        "lastName",
        "email",
        "phone",
        "status",
        "freeze",
        "bmiResult"
      ],
    });

    // Loop through users and fetch associated plans
    const freeTrialList = [];
    const otherPlansList = [];

    const list = await Promise.all(
      users.map(async (user) => {
        // Fetch user plans
        const userPlans = await UserPlan.findOne({
          where: { UserId: user.id },
          attributes: ["id", "expireDate", "buyingDate"],
          include: {
            model: Plan,
            attributes: [
              "id",
              "title",
              "shortDescription",
              "longDescription",
            ],
          },
        });

        // Safely handle null Plan or userPlans
        const planTitle = userPlans?.Plan?.title;

        // Build the object structure
        const userObj = {
          user: user,
          plans: userPlans,
        };

        // Categorize users based on plan title
        if (planTitle === "Free Trial") {
          freeTrialList.push(userObj);
        } else {
          otherPlansList.push(userObj);
        }

        return userObj;
      })
    );

    // Return response with separate lists
    const response = ApiResponse("1", "All Custom Support Users", {
      freeTrialUsers: freeTrialList,
      otherPlanUsers: otherPlansList,
    });
    return res.json(response);
  } catch (error) {
    console.error(error);
    const response = ApiResponse("0", "Error fetching users", {
      error: error.message,
    });
    return res.status(500).json(response);
  }
}

async function createFreeTrialUser(req, res) {
  const t = await db.transaction();
  try {
    const {
      mainGoal,
      specificIssues,
      prefrences,
      freeTrialUser, // User ID
      slots          // Array of Slot IDs
    } = req.body;

    // Was previously missing entirely — changeFreeTrialStatus exists so
    // admins can turn off new trial signups, but this endpoint never
    // checked it, so the "kill switch" only ever worked for assignFreePlan.
    const freePlan = await Plan.findOne({ where: { title: "Free Trial" } });
    if (!freePlan || !freePlan.status) {
      await t.rollback();
      return res.json(ApiResponse("0", "Free trial is not currently available", {}));
    }

    // Cross-system + duplicate check. Two problems in one:
    //  1. No unique constraint on FreeTrailUsers.freeTrialUser — calling
    //     this twice for the same user created two rows.
    //  2. This never checked the current TrialJourney system at all, so a
    //     user who already ran (or is running) a TrialJourney could still
    //     pick up a legacy free-trial slot assignment through here.
    const [existingFreeTrial, existingJourney, freeTrialUserRow] = await Promise.all([
      FreeTrailUsers.findOne({ where: { freeTrialUser } }),
      TrialJourney.findOne({ where: { userId: freeTrialUser } }),
      User.findOne({ where: { id: freeTrialUser }, attributes: ["id", "usedFreeTrial"] }),
    ]);
    if (existingFreeTrial || existingJourney || freeTrialUserRow?.usedFreeTrial) {
      await t.rollback();
      return res.json(ApiResponse("0", "You've already used your free trial", { alreadyUsed: true }));
    }

    // Create FreeTrailUsers entry inside the transaction.
    const newUser = await FreeTrailUsers.create(
      { mainGoal, specificIssues, prefrences, freeTrialUser },
      { transaction: t }
    );

    // Create all slot entries inside the same transaction.
    // If any slot save fails, the whole operation rolls back — no orphaned
    // FreeTrailUsers row left behind with missing slot data.
    if (Array.isArray(slots) && slots.length > 0) {
      const slotRows = slots.map((slotId) => ({
        freeTrialUserId: newUser.id,
        slotId,
      }));
      await FreeTrailUsersSlots.bulkCreate(slotRows, { transaction: t });
    }

    await t.commit();
    return res.json(ApiResponse("1", "Thank you for your information", {}));

  } catch (error) {
    await t.rollback();
    console.error('[createFreeTrialUser] error:', error.message);
    return res.json(ApiResponse("0", "Internal Server Error", {}));
  }
}



async function getFreeTrialUserById(req, res) {
  try {
    const { id: trainerId, slotId } = req.params;

    // NOTE: The old code had a FreeTrailUsers.destroy() here, purging rows older
    // than 2 days on every GET. That was a destructive side effect on a read
    // endpoint — a trainer viewing their list would silently delete data.
    // Cleanup is now handled exclusively by the nightly freeTrialExpiry cron
    // (helper/freeTrialExpiry.js), which correctly sets user.status=false first
    // so trialChurned.js can pick up the churn notification.

    // Fetch users created within last 2 days who have slots with this trainer.
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const users = await FreeTrailUsers.findAll({
      attributes: ["id", "mainGoal", "specificIssues", "prefrences", "createdAt"],
      where: {
        createdAt: {
          [Op.gte]: twoDaysAgo,
        },
      },
      include: [
        {
          model: FreeTrailUsersSlots,
          attributes: ["id"],
          as: "freeUserSlots",
          include: [
            {
              model: Slot,
              attributes: ["id", "start", "end"],
              as: "slot",
              where: { trainerId: trainerId, id: slotId },
            },
          ],
        },
        {
          model: User,
          attributes: ["id", "email", "firstName", "lastName", "bmiResult"],
          as: "freeUserId",
        },
      ],
    });
    const filteredUsers = users.filter(user => user.freeUserSlots && user.freeUserSlots.length > 0);

    if (filteredUsers.length === 0) {
      return res.json(ApiResponse("1", "Free trial user not found", { filteredUsers: [] }));
    }

    return res.json(ApiResponse("1", "Free trial users fetched", { filteredUsers }));
  } catch (error) {
    console.error("Error in getFreeTrialUsers:", error);
    return res.json(ApiResponse("0", "Internal server error", {}));
  }
}

// Trainer roster for the CURRENT free-trial system (TrialJourney).
// getFreeTrialUserById above only reads FreeTrailUsersSlots, which nothing
// writes to anymore — every trial that goes through trialController.js
// (day1/2/3 booking) stores its slot picks directly on the TrialJourney row
// instead (day1SlotId/day2SlotId/day3SlotId). That left trainers with no way
// to see who's actually coming to their trial classes. This mirrors
// getFreeTrialUserById's (trainerId, slotId) shape so it's a drop-in
// replacement/addition on the trainer-facing screen.
async function getTrialJourneyUsersBySlot(req, res) {
  try {
    const { id: trainerId, slotId } = req.params;
    const slotIdNum = Number(slotId);

    if (!trainerId || !Number.isFinite(slotIdNum)) {
      return res.json(ApiResponse("0", "trainerId and slotId are required", {}));
    }

    // Confirm the slot actually belongs to this trainer before returning
    // anything — same guard getFreeTrialUserById relies on via its include.
    const slot = await Slot.findOne({ where: { id: slotIdNum, trainerId } });
    if (!slot) {
      return res.json(ApiResponse("1", "No trial users found", { users: [] }));
    }

    const journeys = await TrialJourney.findAll({
      where: {
        [Op.or]: [
          { day1SlotId: slotIdNum },
          { day2SlotId: slotIdNum },
          { day3SlotId: slotIdNum },
        ],
      },
      include: [{
        model: User,
        as: "user",
        attributes: ["id", "firstName", "lastName", "email", "bmiResult"],
      }],
    });

    const users = journeys
      .filter((j) => j.user)
      .map((j) => {
        const day = j.day1SlotId === slotIdNum ? 1
          : j.day2SlotId === slotIdNum ? 2
          : 3;
        return {
          user: j.user,
          day,
          bookedAt: j[`day${day}BookedAt`],
          attendedAt: j[`day${day}AttendedAt`],
        };
      });

    return res.json(ApiResponse("1", "Trial journey users fetched", { users }));
  } catch (error) {
    console.error("Error in getTrialJourneyUsersBySlot:", error);
    return res.json(ApiResponse("0", "Internal server error", {}));
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
    const isAdmin    = userType === "Admin";
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
  registration,
  login,
  me,
  add_plan,
  update_plan,
  edit_plan,
  activate_plan,
  block_plan,
  get_all_users,
  activate_user,
  block_user,
  get_all_plans,
  admin_get_profile,
  admin_edit_profile,
  dashboard,
  users_plans,
  login_check,
  add_service,
  get_all_services,
  activate_service,
  update_service,
  block_service,
  add_category,
  all_categories,
  udpate_category,
  get_all_contact_messages,
  get_all_dietitions,
  get_all_trainers,
  dieitionPlans,
  update_dietition_link,
  update_trainer_link,
  dietitionHome,
  getAllDeititions,
  addUser,
  addTeamMember,
  addTrainer,
  getAllActivePlans,
  add_testimonial,
  get_testimonials,
  get_plans,
  addAnnouncement,
  updateUser,
  trainerHome,
  slotStatus,
  serverTime,
  updateLink,
  updateDietitionLink,
  getMyDietSlots,
  getMyUpcomingConsultations,
  userHome,
  addReport,
  userReports,
  getAnnouncement,
  freeze,
  addReview,
  getReviews,
  syncrhonize,
  delete_user,
  addImage,
  getAllPlanImages,
  approvedImage,
  sendNotification_to_all_users,
  getTeamMember,
  sendOtp,
  verifyOtp,
  updatePassword,
  guestLogin,
  getGuest,
  payment,
  payment_success,
  get_subcategories,
  get_subcategories_based_on_user_types,
  get_plans_based_on_sub_categories,
  get_users_based_on_types,
  workout_plans,
  assign_workout_diet_plan,
  dietition_add_plan,
  update_user,
  addDiet,
  dietitionPlans,
  userDietPlans,
  addProgressImages,
  getProgressImages,
  dietPlanDetails,
  workout_plan_details,
  user_workout_plans,
  getFreePlan,
  changeFreeTrialStatus,
  getAllHealthTips,
  addTip,
  userCount,
  completeDietPlan,
  addDietitionReview,
  getRating,
  addDietPdf,
  getDietPdf,
  getAllCustomSupporters,
  add_slots,
  update_slots,
  update_slot_trainer,
  getAllTimesWithSlots,
  get_plans_admin,
  sendNotificaionTest,
  assignFreePlan,
  updateTrainerJoin,
  addUserDetails,
  createFreeTrialUser,
  getFreeTrialUserById,
  getTrialJourneyUsersBySlot,
  update_slot_status,
  socialLogin,
  getDietPlanStatus,
  updateDietPlanStatus,
  cancelUserPlan
};
