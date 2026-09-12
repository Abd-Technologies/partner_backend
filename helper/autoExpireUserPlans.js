const { Op } = require("sequelize");
const { UserPlan, User, sequelize } = require("../models");

// Sweeps every UserPlan whose expireDate has passed and flags it via
// planStatus = 'expired'. Before this, nothing on the backend ever
// marked a plan expired — the row just sat there with a past date, and
// the app (and the Mixpanel `Subscription Expired` event) had to
// re-derive "expired" from a client-side date comparison every time.
// This gives that a real, once-only, server-side source of truth.
//
// Deliberately does NOT touch UserPlan's own `status` boolean column —
// that flag controls whether GET /users/get_user_plans returns the row
// at all (see userController.js:347 and paymentController.js:13, both
// `where: [{ status: true }, ...]`), and the app relies on still
// receiving an expired plan so it can show "Plan expired — renew now".
// This cron only tags the UserPlan row, it never hides it.
//
// It DOES flip User.status (a separate, account-level column) to false
// once a user has no other active plan — that's the flag the Flutter
// app actually gates the paid vs. unpaid home screen on (see
// HomeScreen.build: `user.status == true` -> PaidHomeScreenV2). Before
// this, only free-trial expiry (freeTrialExpiry.js) ever flipped it, so
// a regular paid plan that ran out kept full in-app paid access until
// the user happened to log out and back in. Mirrors freeTrialExpiry.js's
// approach, just without destroying the UserPlan row (paid history is
// worth keeping; trial rows aren't).
//
// Skips currently-frozen plans (frozenAt not null) — a freeze pauses
// the plan's clock, so an old expireDate there doesn't mean it should
// be marked expired. Mirrors the caution in autoUnfreezeExpiredPlans.js.
//
// Idempotent and non-destructive: only touches rows where planStatus
// isn't already 'expired', and never overwrites 'completed' (a
// different, unrelated signal set by the dietitian-review flow in
// AdminController.js — completeDietPlan / addDietitionReview). Once a
// plan is flagged expired, it stays flagged; this never re-fires for
// the same row.
//
// Runs hourly, not per-minute like the freeze/session crons — expiry
// is a day-granularity concept, so hourly precision is more than
// enough and keeps the extra DB load small.
//
// Returns the array of UserPlan ids that were newly marked expired.
async function autoExpireUserPlans() {
  const now = new Date();
  const candidates = await UserPlan.findAll({
    where: {
      expireDate: { [Op.ne]: null, [Op.lt]: now },
      frozenAt: null,
      [Op.or]: [
        { planStatus: null },
        { planStatus: { [Op.notIn]: ["expired", "completed"] } },
      ],
    },
    attributes: ["id"],
  });

  if (candidates.length === 0) return [];

  const expired = [];
  for (const candidate of candidates) {
    const t = await sequelize.transaction();
    try {
      // Re-fetch inside the transaction with a row lock so we don't
      // race a concurrent freeze/unfreeze, renewal, or admin action.
      const plan = await UserPlan.findOne({
        where: { id: candidate.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!plan) {
        await t.rollback();
        continue;
      }
      const alreadyTagged =
        plan.planStatus === "expired" || plan.planStatus === "completed";
      const stillExpired =
        plan.expireDate && new Date(plan.expireDate) < now;
      if (plan.frozenAt || alreadyTagged || !stillExpired) {
        await t.rollback();
        continue;
      }
      plan.planStatus = "expired";
      await plan.save({ transaction: t });

      // Only revoke account-level paid access if there's no other plan
      // still covering this user (mirrors the same guard in
      // AdminController.cancelUserPlan / planFreezeController.cancelPlan).
      //
      // BUG FIX: `{ [Op.notIn]: ["cancelled"] }` compiles to SQL
      // `planStatus NOT IN ('cancelled')`, which evaluates to NULL (not
      // true) when planStatus IS NULL — silently excluding every
      // ordinary never-touched plan (the vast majority in production)
      // from ever counting as "other active plan". Must allow NULL
      // through explicitly, same fix as the other two callers of this
      // same guard.
      const otherActivePlan = await UserPlan.findOne({
        where: {
          userId: plan.userId,
          id: { [Op.ne]: plan.id },
          [Op.or]: [
            { planStatus: null },
            { planStatus: { [Op.notIn]: ["cancelled"] } },
          ],
          expireDate: { [Op.gt]: now },
        },
        transaction: t,
      });
      if (!otherActivePlan) {
        await User.update(
          { status: false },
          { where: { id: plan.userId }, transaction: t }
        );
      }

      await t.commit();
      expired.push(candidate.id);
    } catch (err) {
      await t.rollback();
      console.error(`[auto-expire-plans] plan ${candidate.id} failed:`, err.message);
    }
  }

  return expired;
}

module.exports = { autoExpireUserPlans };
