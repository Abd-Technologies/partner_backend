// Admin controller — diet.
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
const {
  ApiResponse,
  PdfDietsForUserNew,
  User,
  UserPlan,
  response,
  sendNotification,
  PlanDietition,
  Plan,
  AssignedPlan,
  SlotDiet,
  TimeDietition,
  Appointment,
  Op,
  SubCategory,
  Category,
  DietTime,
  Diet,
  me,
  UserReview,
} = require("./_shared");

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

async function get_all_dietitions(req, res) {
  const users = await User.findAll({
    where: { userType: "Dietition" },
    attributes: { exclude: ["password", "deviceToken"] }, // sec pass 1
  });
  const response = ApiResponse("1", "All Users", users);
  return res.json(response);
}

async function dieitionPlans(req, res) {
  let data = await PlanDietition.findAll({
    where: { DeititionId: req.user.id },
    include: [{
      model: UserPlan,
      include: [
        { model: User, attributes: ["id", "firstName", "lastName", "email", "phone", "image", "bmiResult"] },
        { model: Plan },
      ],
    }],
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
  // Nov 2026: upcoming bookings on this slot get the new link too.
  try {
    await require("../../../helper/meetLinkSync").syncUpcomingLinks([slot.id], slot.dietitionLink);
  } catch (e) {
    console.error("[updateDietitionLink] link sync:", e.message);
  }

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

    // Sec pass 1: the client herself, her dietitian, or Admin.
    {
      const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
      let allowed =
        !!me &&
        (Number(userPlanDetails.userId) === Number(me.id) ||
          Number(planDetails.dietitianId) === Number(me.id) ||
          require("../../../helper/roles").isAdmin(me));
      if (!allowed && me && ["dietition", "dietitian"].includes(String(me.userType || "").trim().toLowerCase())) {
        const ids = await require("../../../helper/dietitianScope").getAssignedClientIds(me.id);
        allowed = ids.has(Number(userPlanDetails.userId));
      }
      if (!allowed) {
        return res.json(ApiResponse("0", "You can only see your own diet plan.", {}));
      }
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

module.exports = {
  get_all_dietitions,
  dieitionPlans,
  update_dietition_link,
  dietitionHome,
  getAllDeititions,
  updateDietitionLink,
  getMyDietSlots,
  getMyUpcomingConsultations,
  dietition_add_plan,
  addDiet,
  dietitionPlans,
  userDietPlans,
  dietPlanDetails,
  completeDietPlan,
  addDietitionReview,
  getRating,
  addDietPdf,
  getDietPdf,
  getDietPlanStatus,
  updateDietPlanStatus,
};
