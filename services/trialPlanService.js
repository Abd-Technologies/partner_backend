// Trial-to-Plan funnel — Step 2 ("Create a lightweight trial UserPlan").
//
// DietPlan.userPlanId is NOT NULL (models/DietPlan.js), so a free-trial
// user needs *some* UserPlan row to attach an auto-generated diet plan
// to. The TrialJourney system (controllers/FrontSite/trialController.js)
// never created one — trials there are just a UserId + day1/2/3 class
// bookings, with no Plan/UserPlan/consultation involved at all. This
// service backfills that missing link without touching the legacy
// FreeTrailUsers/assignFreePlan system or anything about how classes are
// booked.
//
// Both the Plan template and the UserPlan row are findOrCreate'd, so
// calling this repeatedly for the same user (e.g. every /trial/start
// hit, including "already started" replays) is always safe and cheap.
const db = require('../models');
const { Plan, UserPlan } = db;

// Distinct from the legacy "Free Trial" title used by
// AdminController.assignFreePlan — that one is a real, sellable Plan
// with its own Price/PriceDurations rows. This is a system placeholder
// that is never sold and never shown in any plan-picker, which is also
// why status is left false (most "available plans" listings filter on
// Plan.status = true).
const TRIAL_PLAN_TITLE = 'System — Trial Auto Diet Plan';

// How long the placeholder UserPlan itself stays "active" for the
// purposes of helper/popupEligibility.js's outer `expireDate >= now`
// filter (see evaluateForUser). Generous and independent of the 3-day
// live-class trial window and the 7-day auto-generated diet plan — this
// just needs to comfortably outlive both so the daily-log-reminder popup
// keeps working for as long as the user is realistically still engaging
// with the free trial. Product can tighten this later; nothing else
// depends on the exact number.
const TRIAL_USER_PLAN_LIFETIME_DAYS = 90;

async function _ensureTrialPlanTemplate(transaction) {
  const [plan] = await Plan.findOrCreate({
    where: { title: TRIAL_PLAN_TITLE },
    defaults: {
      title: TRIAL_PLAN_TITLE,
      shortDescription:
        'Internal placeholder plan. Backs auto-generated trial diet plans — not sold, never shown to users.',
      status: false,
      isDefault: false,
    },
    transaction,
  });
  return plan;
}

/**
 * Idempotently ensures `userId` has a trial-tier UserPlan row, creating
 * the shared placeholder Plan template on first use. Safe to call from
 * inside an existing transaction (pass it through) or standalone.
 *
 * Deliberately does NOT cache the template lookup across calls — this
 * can run inside a caller's transaction that later rolls back (e.g. the
 * race-condition path in trialController.startTrial), and a process-wide
 * cache would then keep handing out a Plan id that was never actually
 * committed. findOrCreate is one cheap indexed SELECT; that's a fine
 * price for correctness here since this only runs on /trial/start and
 * the trial quick-intake submit, not a hot path.
 *
 * @param {number} userId
 * @param {import('sequelize').Transaction|null} [transaction]
 * @returns {Promise<UserPlan>}
 */
async function ensureTrialUserPlan(userId, transaction = null) {
  const plan = await _ensureTrialPlanTemplate(transaction);

  const [userPlan] = await UserPlan.findOrCreate({
    where: { userId, PlanId: plan.id, isTrial: true },
    defaults: {
      userId,
      PlanId: plan.id,
      isTrial: true,
      status: true,
      price: 0,
      buyingDate: new Date(),
      expireDate: new Date(
        Date.now() + TRIAL_USER_PLAN_LIFETIME_DAYS * 24 * 60 * 60 * 1000
      ),
    },
    transaction,
  });

  return userPlan;
}

module.exports = { ensureTrialUserPlan, TRIAL_PLAN_TITLE };
