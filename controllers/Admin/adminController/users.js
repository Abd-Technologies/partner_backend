// Admin controller — users.
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
const {
  freeze,
  User,
  ApiResponse,
  bcrypt,
  UserPlan,
  response,
  Plan,
  Category,
  Service,
  Wallet,
  sequelize,
  me,
  WeeklyCheckin,
  currentWeekMonday,
  PriceDurations,
  issueToken,
  sendNotification,
  AssignedPlan,
  Countries,
  Testimonial,
  FreeTrailUsers,
  FreeTrailUsersSlots,
  Op,
} = require("./_shared");

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

    // Sec pass 1: an admin's password (and login email) can only be
    // changed by that admin herself, never by another account.
    {
      const roles = require("../../../helper/roles");
      const isSelf = String(user.id) === String(req.user && req.user.id);
      const emailChanged =
        email !== undefined && roles.norm(email) !== roles.norm(user.email);
      if (roles.isAdmin(user) && !isSelf && (password || emailChanged)) {
        return res.json(
          ApiResponse("0", "Only that admin can change her own email or password.", {})
        );
      }
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
    // Only her own account, or an admin (not trainers/dietitians).
    const requesterId = req.user && req.user.id;
    if (String(requesterId) !== String(req.body.userId)) {
      const me = await User.findByPk(requesterId, { attributes: ["id", "userType"] });
      if (!require("../../../helper/roles").isAdmin(me)) {
        return res.json(ApiResponse("0", "You can only delete your own account.", {}));
      }
    }
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

async function addUserDetails(req, res) {
  try {
    const {
      userId,
      age,
      height,
      weight,
      bmiResult,
      mainGoal,
      healthConditions,
      onboardingStep,
      onboardingDone
    } = req.body;

    const user = await User.findOne({ where: { id: userId } });

    if (user) {
      // Sign-up questions: the app saves what she has answered after each
      // page (draft, onboardingStep set) and once more at the end
      // (onboardingDone). A draft only writes the fields it sends.
      const isDraft = onboardingStep !== undefined && onboardingStep !== null && !onboardingDone;
      if (age !== undefined || !isDraft) user.age = age;
      if (height !== undefined || !isDraft) user.height = height;
      if (weight !== undefined || !isDraft) user.weight = weight;
      if (bmiResult !== undefined || !isDraft) user.bmiResult = bmiResult;
      if (mainGoal !== undefined) user.mainGoal = mainGoal;
      if (healthConditions !== undefined) user.healthConditions = healthConditions;
      if (isDraft) {
        const step = parseInt(onboardingStep, 10);
        if (!isNaN(step)) user.onboardingStep = Math.max(user.onboardingStep || 0, step);
      }
      if (onboardingDone && !user.onboardingDoneAt) user.onboardingDoneAt = new Date();

      await user.save();
      if (isDraft) {
        return res.json(ApiResponse("1", "Saved", {}));
      }

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
    // Added by the team with a plan: no sign-up questions for her.
    if (status) user.onboardingDoneAt = new Date();
    // Growth analytics: how and where she signed up (add-on, no flow change).
    Object.assign(user, require("../../../helper/growthTracking").signupInfo(req.body));
    // CRM (Nov 2026): she signed up from a rep's link — pass its signed ref
    // to the CRM so she lands on her WhatsApp lead (helper/crmHooks.js).
    // Not saved; the CRM checks the signature.
    if (req.body && typeof req.body.crmRef === "string") user._crmRef = req.body.crmRef.slice(0, 120);
    await user.save();
    require("../../../helper/growthTracking").activeDay(user.id);
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
    // Generate JWT access token (web sign-up gets the shorter web token;
    // it has no phone push token to store).
    const isWebSignup = req.body.client === "web";
    const accessToken = issueToken(user, { client: isWebSignup ? "web" : "app" });
    // Update user with deviceToken
    if (!isWebSignup) {
      user.deviceToken = deviceToken;
      await user.save();
    }
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
      onboardingDone: !!user.onboardingDoneAt,
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

        // Days left counted from the real end time (not calendar days on
        // the server's clock): on her last day it's 1, after the end 0.
        // Before, the last day showed 0 (unpaid home) while she was still paid.
        void remaining;
        const remainingDays = plan?.expireDate
          ? Math.ceil((expireDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)) || 0
          : 0;

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
  // Sec pass 1: clients use this to list dietitians / trainers / support
  // reps; they don't get staff emails or phone numbers. Empty strings (not
  // null) because the app's model needs a String there.
  const caller = req.authUser || (req.user && req.user.id
    ? await User.findByPk(req.user.id, { attributes: ["id", "userType"] })
    : null);
  if (!require("../../../helper/roles").isStaff(caller)) {
    const safe = data.map((u) => ({ ...u.toJSON(), email: "", phone: "" }));
    return res.json(ApiResponse("1", "Users Data", { users: safe }));
  }
  let response = ApiResponse("1", "Users Data", { users: data });
  return res.json(response);
}

async function update_user(req, res) {
  // Photo is optional now (was a crash without one), so the web portal can
  // save text-only changes. Only fields that are sent get changed.
  try {
    const { userId, speciality, totalPatients, experience, description } = req.body;
    const user = await User.findOne({ where: { id: userId } });
    if (!user) return res.json(ApiResponse("0", "User not found", {}));
    if (speciality !== undefined) user.speciality = speciality;
    if (totalPatients !== undefined) user.totalPatients = totalPatients;
    if (experience !== undefined) user.experience = experience;
    if (description !== undefined) user.description = description;
    if (req.file && req.file.path) user.image = req.file.path.replace(/\\/g, "/");
    await user.save();
    return res.json(ApiResponse("1", "Updated successfully", {}));
  } catch (e) {
    console.error("[update_user]", e.message);
    return res.json(ApiResponse("0", "Couldn't save the profile. Please try again.", {}));
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

module.exports = {
  get_all_users,
  activate_user,
  block_user,
  dashboard,
  users_plans,
  addUser,
  addTeamMember,
  addTrainer,
  updateUser,
  userHome,
  delete_user,
  getTeamMember,
  get_users_based_on_types,
  update_user,
  userCount,
  getAllCustomSupporters,
  addUserDetails,
};
