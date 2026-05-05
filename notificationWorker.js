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
    const dataPayload = data ?? { isTrainer: "true" };

    // Chunk to avoid FCM errors
  //  const chunks = [];
   // for (let i = 0; i < tokens.length; i += 500) {
    //  chunks.push(tokens.slice(i, i + 500));
  //  }

   // for (const batch of chunks) {
    //  await sendNotification(batch, notification, dataPayload);
  //  }

    await sendTopicNotification('userPlan', notification, dataPayload);

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
