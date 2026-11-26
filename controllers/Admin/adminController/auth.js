// Admin controller — auth.
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
const {
  otpStore,
  ApiResponse,
  User,
  transporter,
  bcrypt,
  revoke,
  issueToken,
  response,
  verifyAccess,
  Op,
  Guest,
} = require("./_shared");

// Oct 2026 security pass: codes are stored per email (helper/otpStore.js),
// expire after 10 min, 5 wrong tries cancel them, max 3 codes / 15 min per
// email. Same answer whether or not the email has an account, and it
// always answers (it used to hang when the email was not found).
async function sendOtp(req, res) {
  const email = otpStore.normEmail(req.body && req.body.email);
  try {
    if (!email) return res.json(ApiResponse("0", "Email is required", {}));
    if (!otpStore.requestAllowed(email)) {
      return res.status(429).json(ApiResponse("0", otpStore.TOO_MANY_REQUESTS, {}));
    }
    let user = await User.findOne({ where: { email: email }, attributes: ["id", "email"] });
    if (user) {
      let OTP = await otpStore.issue(email);
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
    }
    return res.json(ApiResponse("1", otpStore.GENERIC_SENT, {}));
  } catch (error) {
    console.error("sendOtp error:", error);
    return res.json(ApiResponse("0", "Something went wrong. Please try again.", {}));
  }
}

// Looks the code up by email + code (it used to find ANY account by code alone).
async function verifyOtp(req, res) {
  try {
    const email = otpStore.normEmail(req.body && req.body.email);
    const otp = String((req.body && req.body.otp) || "").trim();
    if (!email || !otp) return res.json(ApiResponse("0", "Email and OTP are required.", {}));
    const r = await otpStore.check(email, otp);
    if (!r.ok) return res.json(ApiResponse("0", r.message, {}));
    const userData = await User.findOne({ where: { email: email }, attributes: ["id", "email"] });
    if (!userData) return res.json(ApiResponse("0", "Invalid OTP", {}));
    return res.json(ApiResponse("1", "Opt verified", { userData }));
  } catch (error) {
    console.error("verifyOtp error:", error);
    return res.json(ApiResponse("0", "Something went wrong. Please try again.", {}));
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
      .then(async (dat) => {
        // New password: every old login token stops working.
        try {
          const fresh = await revoke(userData.id);
          if (fresh && req.user && String(req.user.id) === String(userData.id)) {
            // Keep the person who changed it logged in on this device.
            require("../../../helper/authToken").setNewToken(res, issueToken(fresh, { client: require("../../../helper/authToken").clientOf(req.user) }));
          }
        } catch (e) {
          console.error("updatePassword revoke:", e.message);
        }
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
  let validToken = null;
  try {
    validToken = (await verifyAccess(token)).payload;
  } catch (_) {
    validToken = null;
  }
  if (validToken) {
    // (A BlackList table lookup used to be here, but there is no BlackList
    // model, so every call with a valid token crashed. Logging out is handled
    // by tokenVersion: verifyAccess() above already rejects revoked tokens.)
    const response = ApiResponse("1", "Login Already!", {});
    return res.json(response);
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
        const accessToken = issueToken(user);
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
  // Staff web portal (Oct 2026): staff only, found by email (no role
  // picker), and it must NOT overwrite the phone's push token / timezone.
  const isPortal = req.body.client === "portal";
  // Member web app (Oct 2026, client: "web"): same account as the phone.
  // A browser login must not wipe the phone's push token or its timezone,
  // and gets a shorter (7-day) token — helper/authToken.js.
  const isWeb = !isPortal && req.body.client === "web";
  const user = await User.findOne({
    where: isPortal && !userType
      ? { email: email, userType: { [Op.ne]: "User" } }
      : { email: email, userType: userType },
  });
  if (isPortal && !user) {
    const client = await User.findOne({ where: { email: email }, attributes: ["id", "userType"] });
    if (client) {
      return res.json(ApiResponse("0", "This portal is for the Fit Her team. Please use the Fit Her mobile app.", { code: "NOT_STAFF" }));
    }
  }
  if (isPortal && user && String(user.userType || "").trim().toLowerCase() === "user") {
    return res.json(ApiResponse("0", "This portal is for the Fit Her team. Please use the Fit Her mobile app.", { code: "NOT_STAFF" }));
  }
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
      // Portal tokens last 12 h, web 7 days, app tokens 30 days (helper/authToken.js).
      const accessToken = issueToken(user, { client: isPortal ? "portal" : isWeb ? "web" : "app" });
      if (isWeb) {
        // Keep the phone's push token; take the browser's timezone only
        // when she has none yet (first login ever happened on the web).
        if (!user.timeZone && timeZone) {
          user.timeZone = timeZone;
          await user.save();
        }
      } else if (!isPortal) {
        user.deviceToken = deviceToken;
        user.timeZone = timeZone;
        await user.save();
      }
      require("../../../helper/growthTracking").loggedIn(user, isPortal ? "portal" : isWeb ? "web" : "email");
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
        onboardingDone: !!user.onboardingDoneAt,
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
      const accessToken = issueToken(user);

      // Update deviceToken and timeZone
      user.deviceToken = deviceToken;
      user.timeZone = timeZone;
      await user.save();
      require("../../../helper/growthTracking").loggedIn(user, req.body.signupMethod || "social");

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
        onboardingDone: !!user.onboardingDoneAt,
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
    attributes: { exclude: ["password", "deviceToken"] }, // sec pass 1
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
      },
      // Never send password hashes / push tokens to the admin screen.
      attributes: { exclude: ["password", "deviceToken"] },
    });

    let response = ApiResponse("1", "Data retrieved successfully", { data });
    return res.json(response);
  } catch (error) {
    console.error("Error fetching guest data:", error);
    return res.status(200).json(ApiResponse("0", "Nothing Found", {}));
  }
}

module.exports = {
  registration,
  login,
  admin_get_profile,
  admin_edit_profile,
  login_check,
  serverTime,
  sendOtp,
  verifyOtp,
  updatePassword,
  guestLogin,
  getGuest,
  socialLogin,
};
