const { Op } = require("sequelize");
const { UserPlan, sequelize } = require("../models");
const {
  _applyUnfreeze,
  _sendUnfreezeNotification,
} = require("../controllers/FrontSite/planFreezeController");

// Sweeps every UserPlan where the user-initiated freeze has expired
// and flips it back to active. Mirrors autoEndExpiredAppointments:
// runs every minute (PKT-anchored), uses the audit signal
// `unfrozenBy = NULL` to mean "the cron did this, the user didn't
// click Unfreeze themselves".
//
// Only touches the freeze-v2 columns (frozenAt / freezeDays /
// totalFrozenDays / lastUnfrozenAt / unfrozenBy). Legacy admin freezes
// (which write to User.freeze, not UserPlan.frozenAt) are left alone.
//
// Returns array of UserPlan ids that were unfrozen.
async function autoUnfreezeExpiredPlans() {
  const candidates = await UserPlan.findAll({
    where: {
      frozenAt: { [Op.not]: null },
      freezeDays: { [Op.not]: null },
    },
    attributes: ["id", "frozenAt", "freezeDays"],
  });

  if (candidates.length === 0) return [];

  const now = Date.now();
  const ms_per_day = 24 * 60 * 60 * 1000;
  const expired = candidates.filter((p) => {
    const endMs = new Date(p.frozenAt).getTime() + p.freezeDays * ms_per_day;
    return now >= endMs;
  });

  if (expired.length === 0) return [];

  const unfrozen = [];
  for (const candidate of expired) {
    const t = await sequelize.transaction();
    try {
      // Re-fetch inside the transaction with a row lock so we don't
      // race a concurrent manual unfreeze.
      const plan = await UserPlan.findOne({
        where: { id: candidate.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!plan || !plan.frozenAt) {
        await t.rollback();
        continue;
      }
      await _applyUnfreeze(plan, { actorUserId: null, transaction: t });
      await t.commit();
      unfrozen.push(candidate.id);

      // Same "Plan Resumed" push the manual Unfreeze button sends --
      // Shaista's ask was that this should notify the user directly no
      // matter which path resumed the plan, not just the in-app one.
      // Fired after the commit, fire-and-forget, so a notification
      // hiccup on one plan can't stop the sweep from unfreezing the rest.
      _sendUnfreezeNotification(plan.userId).catch((err) =>
        console.error(`[auto-unfreeze] notification error for plan ${candidate.id}:`, err.message)
      );
    } catch (err) {
      await t.rollback();
      console.error(`[auto-unfreeze] plan ${candidate.id} failed:`, err.message);
    }
  }

  return unfrozen;
}

module.exports = { autoUnfreezeExpiredPlans };
