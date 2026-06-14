const { User, OtpData, UserProfile, Plan, BlackList, ShippingSchedule, Service, Time, UserPlan, Category, Contact, UserCycleData, DailyCheckin, WeeklyCheckin, NotificationPreference, PcosScreening, HealthScreening } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const bcrypt = require("bcryptjs");
const { sign } = require("jsonwebtoken");
const sentOtpMail = require("../../helper/sentOtpMail");
const Sequelize = require('sequelize');

function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
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
    const salt = await bcrypt.genSalt(10);

    const user = new User();
    user.firstName = firstName;
    user.lastName = lastName;
    user.email = email;
    user.phone = phone;

    user.userType = "User";
    user.status = 0;
    user.password = await bcrypt.hash(password, salt);
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
          status: dat.status,
          accessToken: accessToken,
        };



        const response = ApiResponse(
          "1",
          "User Registered successfully!",
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
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email: email } });


  if (user) {
    if (user.status == 0) {
      const response = ApiResponse("0", "Sorry! User blocked!", {});
      return res.json(response);
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (validPassword) {
      const accessToken = sign(
        { email: user.email, id: user.id },
        process.env.JWT_ACCESS_SECRET
      );
      let data = {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        accessToken: accessToken,
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
async function logout(req, res) {
  try {
    const user = await User.findOne({ where: { deviceToken: req.body.deviceToken } });

    if (user) {
      user.deviceToken = null;
      await user.save();
      const response = ApiResponse("1", "Logout Successfully!", {});
      return res.json(response); // ✅ FIXED: Add return here
    } else {
      const response = ApiResponse("1", "Logout Successfully!", {});
      return res.json(response);
    }
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json(ApiResponse("0", "Something went wrong", { error: err.message }));
  }
}

async function change_password(req, res) {
  const { password, new_password, confirm_password } = req.body;
  const user = await User.findOne({ where: { id: req.user.id } });
  if (user) {
    const validPassword = await bcrypt.compare(password, user.password);
    if (validPassword) {
      if (new_password === confirm_password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(new_password, salt);
        user
          .save()
          .then((dat) => {
            const response = ApiResponse(
              "1",
              "Password updated successfully!",
              {}
            );
            return res.json(response);
          })
          .catch((error) => {
            const response = ApiResponse("0", error.message, {});
            return res.json(response);
          });
      } else {
        const response = ApiResponse("0", "Confirm password mismatch", {});
        return res.json(response);
      }
    } else {
      const response = ApiResponse("0", "Old password mismatch", {});
      return res.json(response);
    }
  } else {
    const response = ApiResponse("0", "User not exist!", {});
    return res.json(response);
  }
}
async function forget_password(req, res) {

  // Attributes allowlist: schema-drift defence — `useNewProgressHub` is
  // declared in models/User.js but doesn't exist in MySQL, so a default
  // SELECT * fails. Restrict to the columns this controller actually reads
  // (`check` is used for truthy + `check.email`). Tracked for full Phase C
  // schema-drift cleanup; this scoped fix unblocks Phase 0 only.
  const check = await User.findOne({
    where: { email: req.body.email },
    attributes: ['id', 'email'],
  });
  if (check) {
    const checkotp = await OtpData.findOne({ where: { email: check.email } });
    if (checkotp) {
      let OTP = generateOTP();
      checkotp.otp = OTP;
      checkotp.requestAt = new Date();
      checkotp
        .save()
        .then((dat) => {
          sentOtpMail("OTP For Fither", `Your OTP for forget password is ${OTP}`, req.body.email);

          const data = {
            email: check.email,
          };
          const response = ApiResponse("1", "Opt Sent Successfully!", data);
          return res.json(response);
        })
        .catch((error) => {
          const response = ApiResponse("0", error.message, {});
          return res.json(response);
        });
    } else {
      let OTP = generateOTP();
      const newOtp = new OtpData();
      newOtp.requestAt = new Date();
      newOtp.email = check.email;
      newOtp.otp = OTP;
      newOtp.status = true;
      newOtp
        .save()
        .then((dat) => {
          sentOtpMail("OTP For Fither", `Your OTP for forget password is ${OTP}`, req.body.email);
          const data = {
            email: check.email,
          };
          const response = ApiResponse("1", "Opt Sent Successfully!", data);
          return res.json(response);
        })
        .catch((error) => {
          const response = ApiResponse("0", error.message, {});
          return res.json(response);
        });
    }
  } else {
    const response = ApiResponse("0", "Sorry! User not exist", {});
    return res.json(response);
  }
}
async function change_password_after_otp(req, res) {
  const { email, password } = req.body;

  // 1. Verify an OTP record exists for this email
  const otpRecord = await OtpData.findOne({ where: { email: email } });
  if (!otpRecord) {
    const response = ApiResponse("0", "No password reset was requested for this email.", {});
    return res.json(response);
  }

  // 2. Verify OTP was recently generated (within 10 minutes)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  if (!otpRecord.requestAt || otpRecord.requestAt < tenMinutesAgo) {
    const response = ApiResponse("0", "OTP has expired. Please request a new one.", {});
    return res.json(response);
  }

  // 3. Verify OTP status is valid
  if (!otpRecord.status) {
    const response = ApiResponse("0", "OTP has already been used.", {});
    return res.json(response);
  }

  // 4. Find user and update password
  const user = await User.findOne({ where: { email: email } });
  if (!user) {
    const response = ApiResponse("0", "User not exists!", {});
    return res.json(response);
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(password, salt);
  user.save()
    .then(async (dat) => {
      // 5. Invalidate OTP after successful password change
      otpRecord.status = false;
      await otpRecord.save();
      const response = ApiResponse("1", "Password updated successfully!", {});
      return res.json(response);
    })
    .catch((error) => {
      const response = ApiResponse("0", error.message, {});
      return res.json(response);
    });
}
async function get_profile(req, res) {
  const user = await User.findOne({
    where: { id: req.user.id },
    include: [{ model: UserProfile }, { model: ShippingSchedule }],
  });
  const schedule = await ShippingSchedule.findAll({ where: { status: true } });
  const data = {
    user: user,
    schedule: schedule
  };
  const response = ApiResponse("1", "Profile Data", data);
  return res.json(response);
}
async function update_profile(req, res) {
  const user = await User.findByPk(req.user.id);
  user.firstName = req.body.firstName;
  user.lastName = req.body.lastName;
  user.email = req.body.email;
  user.phone = req.body.phone;
  user
    .save()
    .then(async (dat) => {
      const response = ApiResponse("1", "Profile Updated Successfully", {});

      const check = await UserProfile.findOne({
        where: [{ UserId: req.user.id }, { status: true }],
      });
      if (check) {
        check.country = req.body.country;
        check.province = req.body.province;
        check.city = req.body.city;
        check.postalCode = req.body.postalCode;
        check.customCode = req.body.customCode;
        check.address = req.body.address;
        check.company = req.body.company;
        check.status = 1;
        check.UserId = req.user.id;
        check
          .save()
          .then((dat) => {
            const response = ApiResponse("1", "Profile Updated Successfully", {
              firstName: user.firstName,
              lastName: user.lastName,
            });
            return res.json(response);
          })
          .catch((error) => {
            const response = ApiResponse("0", "Something went wrong", {});
            return res.json(response);
          });
      } else {
        const profile = new UserProfile();
        profile.country = req.body.country;
        profile.province = req.body.province;
        profile.city = req.body.city;
        profile.postalCode = req.body.postalCode;
        profile.customCode = req.body.customCode;
        profile.address = req.body.address;
        profile.company = req.body.company;
        profile.status = 1;
        profile.UserId = req.user.id;
        profile
          .save()
          .then((dat) => {
            const response = ApiResponse("1", "Profile Updated Successfully", {
              firstName: user.firstName,
              lastName: user.lastName,
            });
            return res.json(response);
          })
          .catch((error) => {
            const response = ApiResponse("0", "Something went wrong", {});
            return res.json(response);
          });
      }
    })
    .catch((error) => {
      const response = ApiResponse("0", "Something went wrong", {});
      return res.json(response);
    });
}
async function get_plan_details(req, res) {

  const plan = await Plan.findOne({ where: { id: req.params.planId }, include: [{ model: Time }] });
  const response = ApiResponse("1", "Plan Details", plan);
  return res.json(response)
}
async function get_user_plans(req, res) {
  const plans = await UserPlan.findAll({ where: [{ status: true }, { UserId: req.user.id }], include:[ { model: Plan }]});
  const response = ApiResponse("1", "User Plans", plans);
  return res.json(response);
}

async function home(req, res) {

  const plans = await Plan.findAll({ order: Sequelize.literal('RAND()'), limit: 6, });
  const data = {
    "plans": plans
  }
  const response = ApiResponse("1", "Home page Data", data);
  return res.json(response)
}

async function all_services(req, res) {
  const services = await Service.findAll({ where: { status: true } });
  const response = ApiResponse("1", "All Services", services);
  return res.json(response);
}

async function all_plans(req, res) {
  const cateogry = await Category.findOne({ where: { title: "Plans" } });
  const plans = await Plan.findAll({ where: [{ status: true }, { CategoryId: cateogry.id }] });
  const response = ApiResponse("1", "All Plans", plans);
  return res.json(response);
}
async function workout(req, res) {
  const cateogry = await Category.findOne({ where: { title: "WorkOut" } });
  const plans = await Plan.findAll({ where: [{ status: true }, { CategoryId: cateogry.id }], include: { model: Time } });
  const response = ApiResponse("1", "All Plans", plans);
  return res.json(response);
}

async function send_message(req, res) {
  const { firstName, lastName, subject, message, email } = req.body;
  const contact = new Contact();
  contact.firstName = firstName;
  contact.lastName = lastName;
  contact.subject = subject;
  contact.message = message;
  contact.email = email;
  contact.save().then(dat => {
    const response = ApiResponse("1", "Message sent successfully!", {});
    return res.json(response);
  })
    .catch((error) => {
      const response = ApiResponse("0", "Something went wrong", {});
      return res.json(response);
    })
}

async function save_cycle_data(req, res) {
  const { lastPeriodDate, averageCycleLength, isRegular, periodDuration, flowType, dataProvided } = req.body;

  try {
    let cycleData = await UserCycleData.findOne({ where: { userId: req.user.id } });

    if (cycleData) {
      cycleData.lastPeriodDate = lastPeriodDate || null;
      cycleData.averageCycleLength = averageCycleLength || 28;
      cycleData.isRegular = isRegular || null;
      if (periodDuration !== undefined) cycleData.periodDuration = periodDuration;
      if (flowType !== undefined) cycleData.flowType = flowType;
      cycleData.dataProvided = dataProvided !== undefined ? dataProvided : 0;
    } else {
      cycleData = await UserCycleData.create({
        userId: req.user.id,
        lastPeriodDate: lastPeriodDate || null,
        averageCycleLength: averageCycleLength || 28,
        isRegular: isRegular || null,
        periodDuration: periodDuration || null,
        flowType: flowType || null,
        dataProvided: dataProvided !== undefined ? dataProvided : 0,
      });
    }

    // Run cycle engine calculation if data was provided
    if (cycleData.dataProvided === 1 && cycleData.lastPeriodDate) {
      const today = new Date();
      const periodDate = new Date(cycleData.lastPeriodDate);
      const diffTime = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
        - new Date(periodDate.getFullYear(), periodDate.getMonth(), periodDate.getDate()).getTime();
      const daysSince = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      const length = cycleData.averageCycleLength || 28;

      let cycleDay;
      if (daysSince >= length) {
        cycleDay = daysSince + 1;
      } else {
        cycleDay = (daysSince % length) + 1;
      }

      const menstrualEnd = Math.round(length * 0.18);
      const follicularEnd = Math.round(length * 0.46);
      const ovulatoryEnd = Math.round(length * 0.57);

      let phase;
      if (cycleDay <= menstrualEnd) phase = 'menstrual';
      else if (cycleDay <= follicularEnd) phase = 'follicular';
      else if (cycleDay <= ovulatoryEnd) phase = 'ovulatory';
      else phase = 'luteal';

      cycleData.currentCycleDay = cycleDay;
      cycleData.currentPhase = phase;
    } else {
      cycleData.currentCycleDay = null;
      cycleData.currentPhase = null;
    }

    await cycleData.save();

    // Auto-create notification preferences with defaults
    await NotificationPreference.findOrCreate({
      where: { userId: req.user.id },
      defaults: { userId: req.user.id },
    });

    const response = ApiResponse("1", "Cycle data saved", { cycleData });
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_cycle_data(req, res) {
  try {
    const cycleData = await UserCycleData.findOne({ where: { userId: req.user.id } });

    const response = ApiResponse("1", "Cycle data", cycleData);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

// ── Generic health screening (PCOS, Thyroid, Menopause, Postpartum, Endometriosis) ──

async function save_health_screening(req, res) {
  const { conditionType, riskLevel, riskScore, answers } = req.body;
  try {
    if (!conditionType) {
      return res.json(ApiResponse("0", "conditionType is required", {}));
    }

    const screening = await HealthScreening.create({
      userId: req.user.id,
      conditionType,
      riskLevel: riskLevel || null,
      riskScore: riskScore || 0,
      answers: answers ? JSON.stringify(answers) : null,
    });

    // If high risk, auto-add condition to user's healthConditions
    if (riskLevel === 'high' || riskLevel === 'moderate') {
      const user = await User.findOne({ where: { id: req.user.id } });
      if (user) {
        const current = user.healthConditions || '';
        if (!current.includes(conditionType)) {
          user.healthConditions = current ? `${current},${conditionType}` : conditionType;
          await user.save();
        }
      }
    }

    const response = ApiResponse("1", `${conditionType} screening saved`, { screening });
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_health_screening(req, res) {
  try {
    const { conditionType } = req.query;
    const where = { userId: req.user.id };
    if (conditionType) where.conditionType = conditionType;

    const screenings = await HealthScreening.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: conditionType ? 1 : 10,
    });

    const data = conditionType
      ? (screenings.length > 0 ? screenings[0] : null)
      : screenings;

    const response = ApiResponse("1", "Health screening data", data);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

// Keep old PCOS endpoints for backward compat — delegate to generic
async function save_pcos_screening(req, res) {
  req.body.conditionType = 'PCOS';
  return save_health_screening(req, res);
}

async function get_pcos_screening(req, res) {
  req.query = { ...req.query, conditionType: 'PCOS' };
  return get_health_screening(req, res);
}

async function save_daily_checkin(req, res) {
  const {
    date,
    energyLevel,
    moodLevel,
    sleepHours,
    cravingType,
    note,
    cycleDay,
    cyclePhase,
    predictedEnergy,
    predictedMood,
    // Phase A — Progress symptom card. All optional; historical clients that
    // don't send these continue to work unchanged. Validation is loose-bound
    // (range clamp) so a typo can't poison the symptom delta engine.
    bloatingSeverity,
    crampSeverity,
    sleepQuality,
    periodFlow,
  } = req.body;

  // Clamp 0–10 scales. Returns null for invalid input so the row stays
  // semantically "not answered" rather than capping silently.
  const clampScore = (v) => {
    if (v === undefined || v === null) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < 0 || n > 10) return null;
    return Math.round(n);
  };
  const validatePeriodFlow = (v) => {
    if (v === undefined || v === null) return undefined;
    const allowed = ['spotting', 'light', 'medium', 'heavy'];
    return allowed.includes(v) ? v : null;
  };

  const cleanedBloating = clampScore(bloatingSeverity);
  const cleanedCramp = clampScore(crampSeverity);
  const cleanedSleepQuality = clampScore(sleepQuality);
  const cleanedPeriodFlow = validatePeriodFlow(periodFlow);

  try {
    const [checkin, created] = await DailyCheckin.findOrCreate({
      where: { userId: req.user.id, date: date },
      defaults: {
        userId: req.user.id,
        date: date,
        energyLevel: energyLevel || null,
        moodLevel: moodLevel || null,
        sleepHours: sleepHours || null,
        cravingType: cravingType || null,
        note: note || null,
        cycleDay: cycleDay || null,
        cyclePhase: cyclePhase || null,
        predictedEnergy: predictedEnergy || null,
        predictedMood: predictedMood || null,
        bloatingSeverity: cleanedBloating === undefined ? null : cleanedBloating,
        crampSeverity: cleanedCramp === undefined ? null : cleanedCramp,
        sleepQuality: cleanedSleepQuality === undefined ? null : cleanedSleepQuality,
        periodFlow: cleanedPeriodFlow === undefined ? null : cleanedPeriodFlow,
      },
    });

    if (!created) {
      if (energyLevel !== undefined) checkin.energyLevel = energyLevel;
      if (moodLevel !== undefined) checkin.moodLevel = moodLevel;
      if (sleepHours !== undefined) checkin.sleepHours = sleepHours;
      if (cravingType !== undefined) checkin.cravingType = cravingType;
      if (note !== undefined) checkin.note = note;
      if (cycleDay !== undefined) checkin.cycleDay = cycleDay;
      if (cyclePhase !== undefined) checkin.cyclePhase = cyclePhase;
      if (predictedEnergy !== undefined) checkin.predictedEnergy = predictedEnergy;
      if (predictedMood !== undefined) checkin.predictedMood = predictedMood;
      if (cleanedBloating !== undefined) checkin.bloatingSeverity = cleanedBloating;
      if (cleanedCramp !== undefined) checkin.crampSeverity = cleanedCramp;
      if (cleanedSleepQuality !== undefined) checkin.sleepQuality = cleanedSleepQuality;
      if (cleanedPeriodFlow !== undefined) checkin.periodFlow = cleanedPeriodFlow;
      await checkin.save();
    }

    const response = ApiResponse("1", "Daily check-in saved", { checkin });
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_daily_checkin(req, res) {
  try {
    const date = req.query.date;
    if (!date) {
      const response = ApiResponse("0", "Date parameter is required", {});
      return res.json(response);
    }

    const checkin = await DailyCheckin.findOne({ where: { userId: req.user.id, date: date } });

    const response = ApiResponse("1", "Daily check-in", checkin);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_daily_checkins_week(req, res) {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const pad = n => String(n).padStart(2, '0');
    const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const mondayStr = localDate(monday);
    const sundayStr = localDate(sunday);

    const { Op } = require('sequelize');
    const checkins = await DailyCheckin.findAll({
      where: {
        userId: req.user.id,
        date: { [Op.between]: [mondayStr, sundayStr] },
      },
      order: [['date', 'ASC']],
    });

    const response = ApiResponse("1", "Weekly check-ins", checkins);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_daily_checkins_recent(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 7;

    const checkins = await DailyCheckin.findAll({
      where: { userId: req.user.id },
      order: [['date', 'DESC']],
      limit: limit,
    });

    const response = ApiResponse("1", "Recent check-ins", checkins);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function save_weekly_checkin(req, res) {
  const { weekDate, weightKg, waistCm, hipCm, weekRating } = req.body;

  try {
    const [checkin, created] = await WeeklyCheckin.findOrCreate({
      where: { userId: req.user.id, weekDate: weekDate },
      defaults: {
        userId: req.user.id,
        weekDate: weekDate,
        weightKg: weightKg || null,
        waistCm: waistCm || null,
        hipCm: hipCm || null,
        weekRating: weekRating || null,
      },
    });

    if (!created) {
      checkin.weightKg = weightKg || null;
      checkin.waistCm = waistCm || null;
      checkin.hipCm = hipCm || null;
      checkin.weekRating = weekRating || null;
      await checkin.save();
    }

    const response = ApiResponse("1", "Weekly check-in saved", { checkin });
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_weekly_checkins_recent(req, res) {
  try {
    const checkins = await WeeklyCheckin.findAll({
      where: { userId: req.user.id },
      order: [['weekDate', 'DESC']],
      limit: 8,
    });

    const response = ApiResponse("1", "Recent weekly check-ins", checkins);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function get_notification_preferences(req, res) {
  try {
    const [prefs] = await NotificationPreference.findOrCreate({
      where: { userId: req.user.id },
      defaults: { userId: req.user.id },
    });

    const response = ApiResponse("1", "Notification preferences", prefs);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

async function save_notification_preferences(req, res) {
  const {
    morningNudge, classPrep, classStart,
    missedRecovery, trainerCancelled, weeklyCheckin,
    quietStart, quietEnd, timeBlock
  } = req.body;

  const validTimeBlocks = ['morning', 'afternoon', 'evening', 'night', 'all'];

  try {
    let [prefs, created] = await NotificationPreference.findOrCreate({
      where: { userId: req.user.id },
      defaults: { userId: req.user.id },
    });

    if (morningNudge !== undefined) prefs.morningNudge = morningNudge;
    if (classPrep !== undefined) prefs.classPrep = classPrep;
    if (classStart !== undefined) prefs.classStart = classStart;
    if (missedRecovery !== undefined) prefs.missedRecovery = missedRecovery;
    if (trainerCancelled !== undefined) prefs.trainerCancelled = trainerCancelled;
    if (weeklyCheckin !== undefined) prefs.weeklyCheckin = weeklyCheckin;
    if (quietStart !== undefined) prefs.quietStart = quietStart;
    if (quietEnd !== undefined) prefs.quietEnd = quietEnd;
    if (timeBlock !== undefined && validTimeBlocks.includes(timeBlock)) {
      prefs.timeBlock = timeBlock;
    }

    await prefs.save();

    const response = ApiResponse("1", "Notification preferences saved", prefs);
    return res.json(response);
  } catch (error) {
    const response = ApiResponse("0", error.message, {});
    return res.json(response);
  }
}

// ─── PaidHomeScreenV2 — Phase B2.7 ──────────────────────────────────────

const { currentWeekMonday } = require("../../helper/dateUtils");

// POST /users/profile/target_weight
// Body: { targetWeightKg: number|null }  (null clears the goal)
// Updates User.targetWeightKg and returns status-only success envelope.
async function save_target_weight(req, res) {
  try {
    const raw = req.body && req.body.targetWeightKg;
    // Allow explicit null to clear the goal.
    let value = null;
    if (raw !== null && raw !== undefined) {
      const n = Number(raw);
      if (!isFinite(n) || n <= 0 || n > 500) {
        return res.json(
          ApiResponse("0", "targetWeightKg must be a number between 1 and 500, or null", {})
        );
      }
      value = Math.round(n * 10) / 10; // one-decimal precision
    }
    const user = await User.findOne({ where: { id: req.user.id } });
    if (!user) {
      return res.json(ApiResponse("0", "User not found", {}));
    }
    user.targetWeightKg = value;
    await user.save();
    return res.json(
      ApiResponse("1", "Target weight saved", { targetWeightKg: value })
    );
  } catch (err) {
    console.error("save_target_weight:", err);
    return res.json(ApiResponse("0", "Internal server error", {}));
  }
}

// POST /users/profile/feature_flag
// Body: { flag: string, value: boolean }
// Phase E — minimal feature-flag setter for client-side opt-in toggles.
//
// Allow-list of flags is hard-coded so a malicious client can't flip
// arbitrary boolean columns on the User table. Each entry maps a public
// flag name to the underlying User column. Adding a new opt-in here is a
// 1-line change; revoking access is also 1 line.
async function set_feature_flag(req, res) {
  // Allow-listed flags. Keys are what the client sends; values are the
  // matching User column. Today only the Progress hub opt-in is exposed —
  // useNewPaidHome / useNewUnpaidHome are admin-only on purpose so we
  // don't accidentally let users flip themselves into the home V2 beta
  // through the app.
  const ALLOWED_FLAGS = {
    useNewProgressHub: 'useNewProgressHub',
  };

  try {
    const { flag, value } = req.body || {};

    if (typeof flag !== 'string' || !ALLOWED_FLAGS[flag]) {
      return res.json(
        ApiResponse('0', 'Unknown or non-toggleable flag', { flag })
      );
    }
    if (typeof value !== 'boolean') {
      return res.json(
        ApiResponse('0', 'value must be a boolean', { value })
      );
    }

    const column = ALLOWED_FLAGS[flag];
    const user = await User.findOne({
      where: { id: req.user.id },
      attributes: ['id', column],
    });
    if (!user) {
      return res.json(ApiResponse('0', 'User not found', {}));
    }

    user[column] = value;
    await user.save();

    return res.json(
      ApiResponse('1', 'Flag updated', { flag, value })
    );
  } catch (err) {
    console.error('set_feature_flag:', err);
    return res.json(ApiResponse('0', 'Internal server error', {}));
  }
}

// POST /users/weekly_checkin/weight
// Body: { weightKg: number }
// Upserts the current week's WeeklyCheckin row with weightKg. `weekDate` is
// always this week's Monday (Monday-start convention, same as signup).
async function save_weight_log(req, res) {
  try {
    const raw = req.body && req.body.weightKg;
    const n = Number(raw);
    if (!isFinite(n) || n < 20 || n > 500) {
      return res.json(
        ApiResponse("0", "weightKg must be a number between 20 and 500", {})
      );
    }
    const weightKg = Math.round(n * 10) / 10;
    const weekDate = currentWeekMonday();
    const [row, created] = await WeeklyCheckin.findOrCreate({
      where: { userId: req.user.id, weekDate },
      defaults: { weightKg },
    });
    if (!created) {
      row.weightKg = weightKg;
      await row.save();
    }
    return res.json(
      ApiResponse("1", "Weight logged", { weekDate, weightKg })
    );
  } catch (err) {
    console.error("save_weight_log:", err);
    return res.json(ApiResponse("0", "Internal server error", {}));
  }
}

module.exports = {
  registration,
  login,
  forget_password,
  change_password,
  change_password_after_otp,
  update_profile,
  get_profile,
  get_plan_details,
  get_user_plans,
  logout,
  home,
  all_services,
  all_plans,
  workout,
  send_message,
  save_cycle_data,
  get_cycle_data,
  save_pcos_screening,
  get_pcos_screening,
  save_health_screening,
  get_health_screening,
  save_daily_checkin,
  get_daily_checkin,
  get_daily_checkins_week,
  get_daily_checkins_recent,
  save_weekly_checkin,
  get_weekly_checkins_recent,
  get_notification_preferences,
  save_notification_preferences,
  save_target_weight,
  save_weight_log,
  set_feature_flag,
};
