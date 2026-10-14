// Send a test push notification to one user and print exactly what
// Firebase answered. Run from the partner_backend folder:
//
//   node scripts/test_push.js <userId>
//
// It uses the same helper/notification.js the app uses, so if this
// arrives on the phone, the real notifications can too.
require("dotenv").config();
const db = require("../models");
const sendNotification = require("../helper/notification");

(async () => {
  const userId = parseInt(process.argv[2], 10);
  if (!Number.isInteger(userId)) {
    console.log("Usage: node scripts/test_push.js <userId>");
    process.exit(1);
  }
  try {
    const user = await db.User.findByPk(userId, {
      attributes: ["id", "firstName", "lastName", "userType", "deviceToken"],
    });
    if (!user) {
      console.log(`❌ No user with id ${userId}`);
      return;
    }
    console.log(`User: ${user.firstName} ${user.lastName} (${user.userType})`);
    if (!user.deviceToken) {
      console.log(
        "❌ This user has NO deviceToken saved, so no notification can reach her.\n" +
          "   Fix: open the app on her phone, allow notifications, log out and log in again."
      );
      return;
    }
    console.log(`Device token: ${user.deviceToken.slice(0, 20)}…`);

    const res = await sendNotification(
      [user.deviceToken],
      {
        title: "Fit Her test notification",
        body: "If you can see this, notifications are working ✅",
      },
      { type: "testPush" }
    );

    if (res && res.successCount > 0) {
      console.log("✅ Firebase accepted it. Check the phone now (app closed or in background).");
    } else {
      const err =
        res && res.responses && res.responses[0] && res.responses[0].error;
      console.log("❌ Firebase did NOT deliver it.");
      if (err) console.log(`   Error: ${err.code} — ${err.message}`);
      if (res && res.error) console.log(`   Error: ${res.error}`);
      if (err && /not-registered|invalid-registration-token|invalid-argument/.test(err.code || "")) {
        console.log(
          "   This token is old/invalid (app reinstalled or logged in on another phone).\n" +
            "   Fix: log out and log in again on her phone so a fresh token is saved."
        );
      }
    }
  } catch (e) {
    console.error("Script error:", e.message);
  } finally {
    await db.sequelize.close();
  }
})();
