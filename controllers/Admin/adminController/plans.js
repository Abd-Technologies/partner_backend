// Admin controller — plans.
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
const {
  Plan,
  response,
  ApiResponse,
  Category,
  Price,
  PriceDurations,
  Countries,
  Op,
  User,
  TrialJourney,
  UserPlan,
  db,
  sequelize,
  sendNotification,
  stripe,
  DIRECTPAY_NOT_FOUND,
  DIRECTPAY_WINDOW_MS,
  PlanImage,
  applyPlanApproval,
  SAFE_USER,
  extractSlipData,
  FreeTrailUsers,
  FreeTrailUsersSlots,
  Slot,
} = require("./_shared");

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
  if (!service_image) return res.json(ApiResponse("0", "Please add the testimonial picture.", {}));
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

async function payment(req, res) {
  const { planId, amount } = req.body;
  let planData = await Plan.findOne({ where: { id: planId } });
  // The charge must be one of this plan's own prices, never a number the
  // client chose (this used to charge whatever `amount` was sent).
  if (!planData) return res.json(ApiResponse("0", "Plan not found", {}));
  const planPrices = await Price.findAll({ where: { planId } });
  const matchedPrice = planPrices.find((p) => Number(p.priceAmount) === Number(amount));
  if (!matchedPrice) return res.json(ApiResponse("0", "That price doesn't match this plan", {}));
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
            unit_amount: Math.round(Number(matchedPrice.priceAmount) * 100),
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
  const roles = require("../../../helper/roles");
  const caller = req.authUser || null;
  if (caller && roles.isAdmin(caller)) return payment_success_admin(req, res);
  return payment_success_directpay(req, res);
}

async function payment_success_directpay(req, res) {
  const { PaymentAttempt } = require("../../../models");
  const userId = req.user && req.user.id;
  const planId = parseInt(req.body && req.body.planId, 10);
  if (!userId || !planId) return res.json(ApiResponse("0", DIRECTPAY_NOT_FOUND, {}));
  let attempt = null;
  let claimed = false;
  try {
    attempt = await PaymentAttempt.findOne({
      where: {
        userId,
        planId,
        method: "directpay",
        status: "initiated",
        createdAt: { [Op.gte]: new Date(Date.now() - DIRECTPAY_WINDOW_MS) },
      },
      order: [["id", "DESC"]],
    });
    if (!attempt) return res.json(ApiResponse("0", DIRECTPAY_NOT_FOUND, {}));
    // Claim it (once): a second call for the same start finds nothing.
    const [n] = await PaymentAttempt.update({ status: "pending" }, { where: { id: attempt.id, status: "initiated" } });
    if (!n) return res.json(ApiResponse("0", DIRECTPAY_NOT_FOUND, {}));
    claimed = true;

    const planData = await Plan.findOne({ where: { id: planId } });
    if (!planData) throw new Error("Plan not found");
    let durationId = attempt.durationId || null;
    if (!durationId) {
      const prices = await Price.findAll({ where: { planId } });
      const m = prices.find((p) => Number(p.priceAmount) === Number(attempt.amount)) || prices[0];
      durationId = m ? m.durationId : null;
    }
    const amount = Number(attempt.amount) || null;
    const img = await PlanImage.create({
      PlanId: planId,
      UserId: userId,
      image: null,
      PriceDurationId: durationId,
      status: true,
      price: amount != null ? String(amount) : null,
      paidAmount: amount,
      uploadSource: "user_app",
      ocrAmount: amount,
      ocrBank: "DirectPay",
      ocrTransactionId: attempt.ref || null,
      ocrData: {
        method: "directpay",
        refNumber: attempt.ref || null,
        amount,
        autoApproved: true,
        approvalReason: "DirectPay — confirm in the DirectPay merchant portal",
      },
    });
    attempt.planImageId = img.id;
    await attempt.save();
    // End-of-trial offer price: record the discount + mark the offer used.
    try {
      if (await require("../../../helper/trialOffer").applyOfferToSlip({ userId, planId, durationId, price: amount, planImage: img })) {
        await img.save();
      }
    } catch (e) {
      console.warn("[directpay] trial offer:", e.message);
    }

    const result = await applyPlanApproval(img, {
      approvalSource: "auto",
      notify: { title: "Plan activated!", body: "Payment received — your Fit Her plan is now active. Welcome!" },
    });
    if (!result.ok) {
      console.error("[directpay] activation failed:", result.error);
      return res.json(ApiResponse("0", "We couldn't start your plan. Please send the receipt to support.", {}));
    }
    // Same as before: the plan's own dietitian / the trainer from the app.
    try {
      const up = result.userPlanId ? await UserPlan.findByPk(result.userPlanId) : null;
      if (up && !result.extended) {
        const dietitianId = planData.dietitianId != null ? planData.dietitianId : req.body.dietitianId;
        if (dietitianId && !up.dietitianId) up.dietitianId = dietitianId;
        if (req.body.trainerId && !up.trainerId) up.trainerId = req.body.trainerId;
        await up.save();
      }
    } catch (e) {
      console.warn("[directpay] trainer/dietitian:", e.message);
    }
    const user = await User.findOne({ where: { id: userId }, attributes: SAFE_USER });
    return res.json(ApiResponse("1", "Plan assigned successfully", { user }));
  } catch (error) {
    console.error("[directpay] payment_success:", error);
    if (claimed && attempt && !attempt.planImageId) {
      // Nothing was created: let her try again.
      await PaymentAttempt.update({ status: "initiated" }, { where: { id: attempt.id } }).catch(() => {});
    }
    return res.status(500).json(ApiResponse("0", "Error assigning plan", {}));
  }
}

// Admin: old direct behaviour (no DirectPay start needed).
async function payment_success_admin(req, res) {
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

    // Generate response (never send the password hash / push token)
    const safeUser = await User.findOne({ where: { id: userId }, attributes: SAFE_USER });
    let response = ApiResponse("1", "Plan assigned successfully", { user: safeUser });
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
    const { planId, durationId, price } = req.body;
    // A member files a payment slip for HER OWN account. Only staff may file
    // one for someone else — the body's userId used to be trusted from anyone.
    const roles = require("../../../helper/roles");
    const caller = req.user && req.user.id
      ? await User.findByPk(req.user.id, { attributes: ["id", "userType"] })
      : null;
    const userId = caller && roles.isStaff(caller) && req.body.userId
      ? req.body.userId
      : (req.user && req.user.id);
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
        attributes: ['id', 'UserId', 'createdAt', 'verifyStatus'],
        where: { ocrTransactionId: ocrResult.refNumber },
      });
      // Oct 2026: a slip the admin rejected can't be sent again.
      if (dup && dup.verifyStatus === 'rejected') {
        return res.status(200).json(ApiResponse('0',
          'This payment slip was not approved before, so it can\'t be used again. Please contact support.',
          { duplicateOf: dup.id, rejected: true }
        ));
      }
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
    // Slip rules (helper/slipRules.js): our account + reference + date
    // within 3 days + amount. Anything else waits for the admin, with why.
    // Expected amount from the server's prices, not the phone's number.
    let expectedAmount = parseInt(price, 10);
    try {
      const real = await require("../../../helper/slipRules").expectedPriceFor({ userId, planId, durationId, clientPrice: price });
      if (real != null) expectedAmount = real;
    } catch (e) { console.warn("[addImage] expected price:", e.message); }
    let slipDecision = null;
    try {
      slipDecision = await require("../../../helper/slipRules").decideSlip(ocrResult, expectedAmount);
      autoApproved = slipDecision.autoApproved;
      approvalReason = slipDecision.reason;
    } catch (e) {
      console.error("[slipRules] decide failed:", e.message);
      approvalReason = "Slip check failed — admin review";
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
      account:          slipDecision?.account || null,
      slipDate:         slipDecision?.slipDate || null,
      checks:           slipDecision?.checks || null,
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
      const { applyOfferToSlip } = require("../../../helper/trialOffer");
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
    // Oct 2026: every admin (was only the first one), with the reason.
    if (!autoApproved) {
      await require("../../../helper/paymentVerify").notifySlipForReview(newImage, approvalReason);
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
      // + slip check results so the admin sees why it wasn't auto-approved.
      attributes: ["id", "image", "price", "ocrData", "ocrAmount", "ocrDate", "ocrTransactionId", "createdAt"],
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
  // Oct 2026: why it was rejected (picked by the admin; sent to her).
  const rejectReason = String((req.body && req.body.reason) || "").trim().slice(0, 120) || null;
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
    if (!image) return res.json(ApiResponse("0", "Slip not found", {}));
    await require("../../../helper/purchaseLedger").slipRejected(image, req.user ? req.user.id : null);
    // Oct 2026: the slip is KEPT, marked rejected (was deleted). status
    // null = not waiting (true) and not approved (false), so it leaves the
    // approval list and never counts as a sale. Keeping it means the same
    // transaction / reference ID can't be uploaded again.
    const data = image.ocrData && typeof image.ocrData === "object" ? { ...image.ocrData } : {};
    data.rejectReason = rejectReason;
    data.rejectedAt = new Date().toISOString();
    data.rejectedBy = req.user ? req.user.id : null;
    image.ocrData = data;
    image.status = null;
    image.verifyStatus = "rejected";
    await image.save();
    // Nov 2026: a rejected payment-link / WhatsApp slip reopens its request,
    // so she can send a correct slip without the rep making a new one.
    if (image.magicPaymentLinkId) {
      try {
        const { MagicPaymentLink } = require("../../../models");
        await MagicPaymentLink.update(
          { status: "opened", redeemedAt: null, redeemedPlanImageId: null },
          { where: { id: image.magicPaymentLinkId, redeemedPlanImageId: image.id } }
        );
      } catch (e) { console.warn("[approvedImage] reopen link:", e.message); }
    }

    if (user?.deviceToken) {
      let rejectionNotification = {
        title: "Payment slip not approved",
        body: rejectReason
          ? `Reason: ${rejectReason}. Tap to upload a new slip or contact us.`
          : "Sorry, we couldn't approve your slip. Tap to upload a new slip or contact us.",
      };
      sendNotification([user.deviceToken], rejectionNotification, {
        type: "paymentRejected",
        reason: rejectReason || "",
      });
    }

    return res.json(ApiResponse("1", "Plan image rejected and notification sent to User", {}));
  }
  if (!image) return res.json(ApiResponse("0", "Slip not found", {}));
  // Nov 2026: a slip paid before she signed up has no account yet. Approving
  // it used to create a plan for nobody. It starts by itself when she signs
  // up with the phone the rep used (helper/paymentClaims.js).
  if (!image.UserId) {
    const d = image.ocrData && typeof image.ocrData === "object" ? image.ocrData : {};
    if (d.waitingForSignup !== true) {
      d.waitingForSignup = true;
      d.approvedByAdminAt = new Date().toISOString();
      d.approvedByAdmin = req.user ? req.user.id : null;
      image.ocrData = { ...d };
      image.changed("ocrData", true);
      await image.save();
    }
    return res.json(ApiResponse("1", `Approved. Her plan starts when she signs up with ${d.payerPhone || "the phone the rep used"}.`, { waitingForSignup: true }));
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
    existingPlan = await UserPlan.create({
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

  // Purchase history + server-side Mixpanel "Purchase" (add-on).
  require("../../../helper/purchaseLedger").purchased({
    planImage: image,
    userPlanId: existingPlan ? existingPlan.id : null,
    approvedBy: "admin",
    approvedById: req.user ? req.user.id : null,
  });

  // Her ended plans (Oct 2026): switched OFF, no longer deleted (deleting
  // also deleted their diet plan / Day 7 review / progress, and an ended
  // trial plan lost its AI diet plan before it could be moved). status=false
  // hides it from her plan list; planStatus 'expired' is set hourly.
  await UserPlan.update(
    { status: false },
    {
      where: {
        userId: image.UserId,
        expireDate: { [Op.lt]: now },
        status: true,
        id: { [Op.ne]: existingPlan.id },
      },
    }
  );

  // Update user status
  if (user) {
    user.status = true;
    await user.save();
  }

  // Oct 2026: her dietitian comes from the package she bought.
  await require("../../../helper/planDietitianAssign").assignFromPlan(existingPlan && existingPlan.id);

  // Oct 2026: keep her trial diet plan / Day 7 review / progress (moved to
  // the paid plan) and mark the trial converted, BEFORE the trial row is
  // deleted (the DB would cascade-delete them).
  await require("../../../helper/trialConversion").onPaidPlan(image.UserId, existingPlan && existingPlan.id);

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

async function get_plans_based_on_sub_categories(req, res) {
  const { subCategoryId } = req.params;
  let data = await Plan.findAll({ where: { subCategoryId: subCategoryId } });
  let response = ApiResponse("1", "Data", { plans: data });
  return res.json(response);
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

module.exports = {
  add_plan,
  update_plan,
  edit_plan,
  activate_plan,
  block_plan,
  get_all_plans,
  getAllActivePlans,
  get_plans,
  syncrhonize,
  addImage,
  getAllPlanImages,
  approvedImage,
  payment,
  payment_success,
  get_plans_based_on_sub_categories,
  getFreePlan,
  changeFreeTrialStatus,
  get_plans_admin,
  assignFreePlan,
  createFreeTrialUser,
  getFreeTrialUserById,
  cancelUserPlan,
};
