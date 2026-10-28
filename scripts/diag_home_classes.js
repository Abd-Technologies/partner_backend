// Why doesn't Home show upcoming classes? (Oct 2026)
// Run:  node scripts/diag_home_classes.js [userId]
require("dotenv").config();
const { Slot, Time, User, UserPlan } = require("../models");
const { buildLiveAndComingUp } = require("../controllers/FrontSite/DashboardController");

(async () => {
  const userId = parseInt(process.argv[2] || "0", 10) || null;
  const all = await Slot.findAll({ include: [{ model: Time, attributes: ["day"] }] });
  const noTrainer = all.filter((s) => !s.trainerId);
  const placeholder = all.filter((s) => s.start === "Start Time" || s.end === "End Time");
  const noDay = all.filter((s) => !s.Time || !s.Time.day);
  console.log(`\nSlots in total: ${all.length}`);
  console.log(`  without a trainer (Home skips these): ${noTrainer.length}`);
  console.log(`  "Start Time" placeholders (skipped):  ${placeholder.length}`);
  console.log(`  without a weekday (skipped):          ${noDay.length}`);
  const days = {};
  all.forEach((s) => { const d = s.Time ? s.Time.day : "?"; days[d] = (days[d] || 0) + 1; });
  console.log("  per weekday:", days);
  console.log("  sample:", all.slice(0, 5).map((s) => `${s.Time && s.Time.day} ${s.start}-${s.end} trainer=${s.trainerId} status=${s.status}`));

  let tz = null;
  if (userId) {
    const u = await User.findByPk(userId, { attributes: ["id", "timeZone", "status"] });
    tz = u && u.timeZone;
    const plans = await UserPlan.findAll({ where: { userId }, attributes: ["id", "status", "frozenAt", "expireDate", "isTrial"] });
    console.log(`\nUser ${userId}: timeZone=${tz} paid=${u && u.status}`);
    plans.forEach((p) => console.log(`  plan ${p.id}: status=${p.status} frozenAt=${p.frozenAt} expires=${p.expireDate} trial=${p.isTrial}`));
  }
  const r = await buildLiveAndComingUp(tz, userId);
  console.log("\nWhat Home gets now:");
  console.log("  live:", r.live ? `${r.live.classType} ${r.live.start}` : "none");
  console.log("  comingUp:", r.comingUp.length ? r.comingUp.map((c) => `${c.weekday} ${c.start} ${c.classType} (in ${c.dayOffset} day)`) : "EMPTY");
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
