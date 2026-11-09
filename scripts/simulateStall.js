/**
 * simulateStall.js — LOCAL TESTING ONLY. Makes one test user look like she
 * signed up 21 hours ago and never finished the sign-up questions, then runs
 * the "stalled sign-up" check at once (instead of waiting for :15 past the
 * hour). The running server's outbox sends the event to the CRM within 30 s.
 *
 *   node scripts/simulateStall.js 256
 *
 * Refuses to run when NODE_ENV=production.
 */
require("dotenv").config();
(async () => {
  if (String(process.env.NODE_ENV).toLowerCase() === "production") {
    console.error("Refusing to run with NODE_ENV=production.");
    process.exit(1);
  }
  const id = parseInt(process.argv[2], 10);
  if (!id) {
    console.error("Usage: node scripts/simulateStall.js <userId>");
    process.exit(1);
  }
  const db = require("../models");
  const user = await db.User.findByPk(id, { attributes: ["id", "email", "onboardingDoneAt", "createdAt"] });
  if (!user) {
    console.error(`User ${id} not found.`);
    process.exit(1);
  }
  if (!String(user.email || "").endsWith("@example.test")) {
    console.error(`User ${id} is not a test user (email must end with @example.test). Not touching it.`);
    process.exit(1);
  }
  await db.sequelize.query(
    "UPDATE `Users` SET createdAt = NOW() - INTERVAL 21 HOUR, onboardingDoneAt = NULL WHERE id = ?",
    { replacements: [id] }
  );
  const n = await require("../helper/crmEvents").reportStalledSignups();
  console.log(`\n✅ User ${id} now looks 21 h old. onboarding_stalled queued for ${n} woman/women.`);
  console.log("The running server sends it to the CRM within 30 seconds.");
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
