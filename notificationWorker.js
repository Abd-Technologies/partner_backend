const Queue = require("bull");
const { Op } = require("sequelize");
const { Plan, UserPlan, User } = require("./models");
const sendNotification = require("./helper/notification");

const notificationQueue = new Queue("notificationQueue", {
  redis: { host: "127.0.0.1", port: 6379 },
});

// Default options for all jobs
notificationQueue.defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  removeOnComplete: true,
  removeOnFail: false,
};

console.log("Worker is running...");

notificationQueue.process(5, async (job) => {
  try {
    console.log("Processing job:", job.data);

    const { title, body, data, deviceTokens } = job.data;

    // The broadcast-lookup block below is the abandoned duplicate of what
    // is now helper/crownjobfunction.js's getDeviceTokensForSlot() — same
    // "CategoryId 2/3 UserPlan → User.deviceToken" query, just missing the
    // free-trial-slot half and living in the wrong place (the worker
    // shouldn't be responsible for building the roster; the caller queuing
    // the job should). Left commented for history — do not uncomment this;
    // callers (AdminController) now call getDeviceTokensForSlot() before
    // queuing and pass the resolved list in as job.data.deviceTokens.
//    let tokens = deviceTokens;

  //  if (!tokens) {
      // Fetch plans
    //  const plans = await Plan.findAll({
      //  where: { CategoryId: { [Op.or]: [2, 3] } },
      //  attributes: ["id"],
     // });
    //  if (plans.length === 0) return console.log("No plans found.");

      // Fetch users
   //   const userPlanPromises = plans.map((plan) =>
     //   UserPlan.findAll({
       //   where: { planId: plan.id },
       //   include: [{ model: User, attributes: ["deviceToken"] }],
      //  })
     // );

      //const allUserPlans = await Promise.all(userPlanPromises);
     // tokens = allUserPlans.flatMap((userPlans) =>
       // userPlans
         // .filter((up) => up.User && up.User.deviceToken)
        //  .map((up) => up.User.deviceToken)
     // );
   // }

    //if (!tokens || tokens.length === 0) {
    //  return console.log("No device tokens found.");
   // }

    const notification = {
      title: title ?? "Class Link Added",
      body: body ?? "Join the session now",
    };
    // Duplicate type-guessing used to live here (title === "Trainer has
    // Joined" ? "classStart" : "trainerLinkAdded") — a second, narrower
    // copy of the title→type map that already exists in
    // helper/notification.js (TYPE_BY_TITLE). It only knew two titles,
    // so any other title (e.g. "Class Cancelled") would have silently
    // fallen through to the wrong default once callers started sending
    // it. sendNotification() already resolves `type` from TYPE_BY_TITLE
    // when data.type is absent, so there is nothing to do here — just
    // pass the data payload through.
    const dataPayload = data ?? {};
    const tokens = Array.isArray(deviceTokens) ? deviceTokens.filter(Boolean) : [];
    if (tokens.length === 0) {
      return console.log("No device tokens found.");
    }

    // Chunk to avoid FCM errors
  //  const chunks = [];
   // for (let i = 0; i < tokens.length; i += 500) {
    //  chunks.push(tokens.slice(i, i + 500));
  //  }

    await sendNotification(tokens, notification, dataPayload);

    console.log(`✅ Notification sent to ${tokens.length} devices.`);
  } catch (error) {
    console.error("❌ Error processing job:", error);
    throw error; // Let Bull retry
  }
});

notificationQueue.on("error", (err) => {
  console.error("Queue Error:", err);
});

notificationQueue.on("failed", (job, err) => {
  console.error(`Job ${job.id} failed with error:`, err);
});

notificationQueue.on("completed", (job) => {
  console.log(`Job ${job.id} completed.`);
});
