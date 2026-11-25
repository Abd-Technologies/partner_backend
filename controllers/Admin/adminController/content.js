// Admin controller — content.
// Split out of AdminController.js (Nov 2026) — code moved unchanged; only
// require paths are one folder deeper. AdminController.js re-exports everything.
const {
  Testimonial,
  response,
  ApiResponse,
  HealthTips,
  Contact,
  Announcement,
  User,
  Op,
  sendNotification,
  Report,
  WeeklyCheckin,
  currentWeekMonday,
  Review,
  ProgressImage,
} = require("./_shared");

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

async function getAllHealthTips(req, res) {
  const healthTips = await HealthTips.findAll({});
  const data = {
    healthTips: healthTips,
  };
  const response = ApiResponse("1", "All Health Tips", data);
  return res.json(response);
}

async function get_all_contact_messages(req, res) {
  const messages = await Contact.findAll({});
  const response = ApiResponse("1", "All messages", messages);
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
    .then(async (dat) => {
      // The weekly measurements also count as this week's weigh-in, so
      // the Progress tab's weight trend and the PDF report see it.
      try {
        const w = parseFloat(currentWeight);
        if (!isNaN(w) && w > 0 && userId) {
          const [row, created] = await WeeklyCheckin.findOrCreate({
            where: { userId, weekDate: currentWeekMonday() },
            defaults: { weightKg: w },
          });
          if (!created) await row.update({ weightKg: w });
        }
      } catch (e) {
        console.warn("[addReport] weekly weight sync failed:", e.message);
      }
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

async function addReview(req, res) {
  const { comment, value, PlanId, userId, classReview, trainerOrDiet } = req.body;
  let rating = new Review();
  rating.comment = comment;
  rating.value = value;
  rating.PlanId = PlanId;
  rating.userId = (req.user && req.user.id) || userId;
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
  const ratings = await Review.findAll({ order: [["createdAt", "DESC"]], limit: 500 });
  return res.json(ApiResponse("1", "ok", { reviews: ratings }));
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

module.exports = {
  get_all_contact_messages,
  add_testimonial,
  get_testimonials,
  addAnnouncement,
  addReport,
  userReports,
  getAnnouncement,
  addReview,
  getReviews,
  sendNotification_to_all_users,
  addProgressImages,
  getProgressImages,
  getAllHealthTips,
  addTip,
  sendNotificaionTest,
};
