'use strict';

/**
 * Free trial expiry — server-side nightly cleanup.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Previously, free trial expiry was detected only inside userHome() — called
 * when the user opens the app. If the user never opened the app after their
 * trial ended, user.status stayed true indefinitely and trialChurned.js never
 * fired (it requires status=false). This cron fixes that.
 *
 * ─── What it does ────────────────────────────────────────────────────────────
 * 1. Finds all UserPlan rows where:
 *    - Plan.title = "Free Trial"
 *    - expireDate < now
 *    - user.status = true  (not yet cleaned up)
 * 2. For each expired plan:
 *    a. Sets user.status = false  (triggers trialChurned.js re-engagement)
 *    b. Destroys the UserPlan row
 *    c. Destroys FreeTrailUsers + FreeTrailUsersSlots rows (if they exist)
 * 3. Logs a summary.
 *
 * ─── Safety ──────────────────────────────────────────────────────────────────
 * Each user's cleanup is wrapped in a try/catch so one failure doesn't
 * abort the whole batch. Errors are logged with userId for manual recovery.
 *
 * userHome() still has its own inline expiry check — that stays as a
 * same-session fallback (e.g. if the cron was down the night the trial expired).
 * The double-run is safe because the second run finds status=false / no UserPlan
 * and does nothing.
 *
 * Runs: nightly at 02:00 PKT via app.js cron.
 */

const { Op } = require('sequelize');
const { User, UserPlan, Plan, FreeTrailUsers, FreeTrailUsersSlots } = require('../models');

async function expireFreeTrial(userId, userPlanId, planId) {
  const user = await User.findOne({
    where: { id: userId },
    attributes: ['id', 'status'],
  });
  if (!user) return;

  // Flip status so trialChurned.js picks them up at 09:05 PKT.
  user.status = false;
  await user.save();

  // Destroy the expired UserPlan row.
  await UserPlan.destroy({
    where: { id: userPlanId },
  });

  // Destroy FreeTrailUsers preferences + slot records (may not exist if admin
  // assigned the plan via assignFreePlan without calling createFreeTrialUser).
  const freeTrail = await FreeTrailUsers.findOne({
    where: { freeTrialUser: userId },
  });
  if (freeTrail) {
    await FreeTrailUsersSlots.destroy({
      where: { freeTrialUserId: freeTrail.id },
    });
    await freeTrail.destroy();
  }
}

async function runFreeTrialExpiryBatch() {
  try {
    const freePlan = await Plan.findOne({ where: { title: 'Free Trial' } });
    if (!freePlan) {
      console.log('[free-trial-expiry] No "Free Trial" plan found — skipping.');
      return;
    }

    const now = new Date();

    // Find all expired Free Trial UserPlans whose user is still marked active.
    const expiredPlans = await UserPlan.findAll({
      where: {
        planId:     freePlan.id,
        expireDate: { [Op.lt]: now },
      },
      include: [{
        model:    User,
        required: true,
        where:    { status: true },    // only users not yet cleaned up
        attributes: ['id', 'status'],
      }],
      attributes: ['id', 'userId', 'planId'],
    });

    if (expiredPlans.length === 0) {
      console.log('[free-trial-expiry] No expired trials to process.');
      return;
    }

    let success = 0;
    let failed  = 0;

    for (const plan of expiredPlans) {
      try {
        await expireFreeTrial(plan.userId, plan.id, plan.planId);
        success++;
      } catch (err) {
        failed++;
        console.error(
          `[free-trial-expiry] Failed for userId=${plan.userId}: ${err.message}`
        );
      }
    }

    console.log(
      `[free-trial-expiry] processed=${expiredPlans.length} ` +
      `success=${success} failed=${failed}`
    );
  } catch (err) {
    console.error('[free-trial-expiry] Batch failed:', err.message);
  }
}

module.exports = { runFreeTrialExpiryBatch };
