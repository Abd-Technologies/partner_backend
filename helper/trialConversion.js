// When a trial client pays (Oct 2026).
//
// Before: the Free Trial UserPlan row was deleted on payment, and the DB
// deletes everything linked to it (ON DELETE CASCADE): her AI trial diet
// plan (+ days, meals), Day 7 review and progress submissions. Her trial
// was also never marked converted, so the app kept showing the trial.
//
// Now, called BEFORE the trial row is deleted:
//   1. her trial diet plan / Day 7 review / progress submissions are moved
//      to the new paid plan, so they are kept and her Diet tab keeps the
//      plan until the dietitian's plan replaces it;
//   2. TrialJourneys.convertedAt is set, so the app stops showing the trial.
const { Op } = require("sequelize");

const M = () => require("../models");

async function trialUserPlanIds(userId) {
  const { UserPlan, Plan } = M();
  const free = await Plan.findOne({ where: { title: "Free Trial" }, attributes: ["id"] });
  const or = [{ isTrial: true }];
  if (free) or.push({ PlanId: free.id });
  const rows = await UserPlan.findAll({ where: { userId, [Op.or]: or }, attributes: ["id"] });
  return rows.map((r) => r.id);
}

async function onPaidPlan(userId, paidUserPlanId) {
  if (!userId) return;
  const db = M();
  try {
    if (paidUserPlanId) {
      const ids = (await trialUserPlanIds(userId)).filter((id) => id !== paidUserPlanId);
      if (ids.length) {
        for (const name of ["DietPlan", "Day7Review", "ProgressSubmission"]) {
          if (!db[name]) continue;
          const [n] = await db[name].update(
            { userPlanId: paidUserPlanId },
            { where: { userPlanId: { [Op.in]: ids } } }
          );
          if (n) console.log(`[trial-convert] user ${userId}: kept ${n} ${name} row(s)`);
        }
      }
    }
  } catch (e) {
    console.error("[trial-convert] move:", e.message);
  }
  try {
    if (db.TrialJourney) {
      await db.TrialJourney.update(
        { convertedAt: new Date() },
        { where: { userId, convertedAt: null } }
      );
    }
  } catch (e) {
    console.error("[trial-convert] journey:", e.message);
  }
}

module.exports = { onPaidPlan };
