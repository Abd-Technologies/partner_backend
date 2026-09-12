const { Op } = require("sequelize");
const { UserPlan, Appointment, User, sequelize } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const sendNotification = require("../../helper/notification");

// User-button freeze flow. Decisions baked in (see docs/Freeze_Logic_Audit.md):
//   • Unlimited freezes per plan, no cooldown — the cumulative cap
//     (totalFrozenDays ≤ originalDurationDays) is the only abuse guard.
//     The math is correct under rapid toggling: spentDays ≈ 0 on a
//     near-instant unfreeze means full refund, so loops don't extend
//     the plan beyond original duration.
//   • Cumulative cap = original plan duration in days
//   • Auto-cancel pending/confirmed/In-Progress appointments inside the
//     freeze window, with FCM to user and dietitian
//   • Auto-unfreeze cron flips back to active when frozenAt + freezeDays
//     elapses (sets unfrozenBy = NULL as the audit signal for cron-driven)

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Picks the user's currently-active plan. "Active" = expireDate in the
// future. If multiple, return the one expiring latest (typically the
// freshest purchase). Returns null if no active plan.
async function getActivePlan(userId, transaction) {
  return UserPlan.findOne({
    where: {
      userId,
      expireDate: { [Op.gt]: new Date() },
      // Excludes a plan cancelled ahead of its natural expiry (see
      // cancelPlan below) — without this, freeze/unfreeze/freeze-status
      // would keep treating a cancelled-but-not-yet-expired plan as
      // active until the date caught up.
      //
      // BUG FIX: a bare `{ [Op.ne]: "cancelled" }` compiles to SQL
      // `planStatus <> 'cancelled'`, and in SQL, comparing NULL to
      // anything (even with <>) evaluates to NULL, not true — so it
      // silently excluded every plan that was never touched by
      // cancel/expire logic (planStatus IS NULL), which is nearly every
      // plan in production. That broke freeze/unfreeze/freeze-status for
      // real paying users the moment this shipped. Must explicitly allow
      // NULL through.
      [Op.or]: [
        { planStatus: null },
        { planStatus: { [Op.ne]: "cancelled" } },
      ],
    },
    order: [["expireDate", "DESC"]],
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined,
  });
}

function diffDays(later, earlier) {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  return Math.floor(ms / MS_PER_DAY);
}

function shiftDate(d, days) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

// POST /users/plan/freeze   body: { days }
exports.freezePlan = async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const days = Number(req.body.days);
  if (!Number.isInteger(days) || days < 1) {
    return res.json(ApiResponse("0", "days must be a positive integer", {}));
  }

  const t = await sequelize.transaction();
  try {
    const plan = await getActivePlan(req.user.id, t);
    if (!plan) {
      await t.rollback();
      return res.json(ApiResponse("0", "No active plan to freeze", {}));
    }
    if (plan.frozenAt) {
      await t.rollback();
      return res.json(ApiResponse("0", "Plan is already frozen", {}));
    }

    // Snapshot originalDurationDays on first freeze. After this row is
    // set, subsequent freezes (which see an already-extended expireDate)
    // can still validate against the true original.
    let originalDurationDays = plan.originalDurationDays;
    if (originalDurationDays == null) {
      if (!plan.buyingDate || !plan.expireDate) {
        await t.rollback();
        return res.json(
          ApiResponse("0", "Plan is missing buyingDate or expireDate; cannot compute duration", {})
        );
      }
      originalDurationDays = diffDays(plan.expireDate, plan.buyingDate);
      if (originalDurationDays <= 0) {
        await t.rollback();
        return res.json(
          ApiResponse("0", "Plan duration is invalid; contact support", {})
        );
      }
    }

    const remainingFreezeBudget = originalDurationDays - (plan.totalFrozenDays || 0);
    if (days > remainingFreezeBudget) {
      await t.rollback();
      return res.json(
        ApiResponse(
          "0",
          `You can freeze for up to ${remainingFreezeBudget} more day(s) on this plan.`,
          { remainingFreezeBudget, requested: days }
        )
      );
    }

    const now = new Date();

    // Second, independent cap: don't let a single freeze outrun how much
    // of the plan is actually left right now. 30 days until expiry ->
    // max freeze is 29 (must leave at least 1 day of runway) -- this is
    // separate from remainingFreezeBudget above, which only tracks the
    // plan's lifetime total. Whichever cap is tighter wins.
    const daysUntilExpiry = diffDays(plan.expireDate, now);
    if (days >= daysUntilExpiry) {
      await t.rollback();
      const maxAllowed = Math.max(daysUntilExpiry - 1, 0);
      return res.json(
        ApiResponse(
          "0",
          maxAllowed > 0
            ? `You can freeze for at most ${maxAllowed} more day(s) right now -- freezing must leave at least 1 day before your plan expires.`
            : `Your plan expires too soon to freeze right now.`,
          { daysUntilExpiry, maxAllowed, requested: days }
        )
      );
    }

    const windowEnd = shiftDate(now, days);

    // Auto-cancel pending/confirmed/In-Progress appointments inside the
    // freeze window. The audit columns we added earlier track who did
    // it (the user, via req.user.id) and when.
    const liveInWindow = await Appointment.findAll({
      where: {
        userId: req.user.id,
        date: { [Op.between]: [now, windowEnd] },
        status: { [Op.in]: ["pending", "confirmed", "In Progress"] },
      },
      transaction: t,
    });

    for (const appt of liveInWindow) {
      appt.status = "canceledByUser";
      appt.completed_by = req.user.id;
      appt.status_changed_at = now;
      appt.message = "Auto-cancelled: user paused plan";
      await appt.save({ transaction: t });
    }

    // Push expiry forward by the freeze duration.
    plan.expireDate = shiftDate(plan.expireDate, days);
    plan.frozenAt = now;
    plan.freezeDays = days;
    plan.originalDurationDays = originalDurationDays;
    plan.frozenBy = req.user.id;
    await plan.save({ transaction: t });

    await t.commit();

    // Notifications fire after the commit so a notification failure
    // can't roll back the freeze itself.
    const dietitianIds = [...new Set(liveInWindow.map((a) => a.dietitionId).filter(Boolean))];
    sendFreezeNotifications(req.user.id, days, windowEnd, liveInWindow, dietitianIds).catch(
      (err) => console.error("[freeze] notification error:", err.message)
    );

    return res.json(
      ApiResponse("1", "Plan frozen", {
        frozenAt: now,
        freezeDays: days,
        willResumeOn: windowEnd,
        autoCancelledAppointments: liveInWindow.map((a) => a.id),
        newExpireDate: plan.expireDate,
      })
    );
  } catch (error) {
    await t.rollback();
    console.error("[freeze] error:", error);
    return res.status(500).json(ApiResponse("0", "Error freezing plan", { error: error.message }));
  }
};

// POST /users/plan/unfreeze   body: {}
exports.unfreezePlan = async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const t = await sequelize.transaction();
  try {
    const plan = await getActivePlan(req.user.id, t);
    if (!plan) {
      await t.rollback();
      return res.json(ApiResponse("0", "No active plan", {}));
    }
    if (!plan.frozenAt) {
      await t.rollback();
      return res.json(ApiResponse("0", "Plan is not currently frozen", {}));
    }

    const result = await applyUnfreeze(plan, { actorUserId: req.user.id, transaction: t });
    await t.commit();

    // Notification fires after the commit, same as freezePlan above --
    // a notification failure must never roll back (or block) the unfreeze.
    sendUnfreezeNotification(req.user.id).catch(
      (err) => console.error("[unfreeze] notification error:", err.message)
    );

    return res.json(ApiResponse("1", "Plan unfrozen", result));
  } catch (error) {
    await t.rollback();
    console.error("[unfreeze] error:", error);
    return res.status(500).json(ApiResponse("0", "Error unfreezing plan", { error: error.message }));
  }
};

// Shared between manual unfreeze and the cron. actorUserId = NULL means
// the cron did it (audit signal). Caller must own the transaction.
async function applyUnfreeze(plan, { actorUserId, transaction }) {
  const now = new Date();
  const spentDays = diffDays(now, plan.frozenAt);
  const safeSpent = Math.max(0, Math.min(spentDays, plan.freezeDays));
  const unspentDays = plan.freezeDays - safeSpent;

  // Refund unspent portion of the expiry extension.
  if (unspentDays > 0) {
    plan.expireDate = shiftDate(plan.expireDate, -unspentDays);
  }

  plan.totalFrozenDays = (plan.totalFrozenDays || 0) + safeSpent;
  plan.frozenAt = null;
  plan.freezeDays = null;
  plan.lastUnfrozenAt = now;
  plan.unfrozenBy = actorUserId;
  await plan.save({ transaction });

  return {
    unfrozenAt: now,
    refundedDays: unspentDays,
    totalFrozenDays: plan.totalFrozenDays,
    newExpireDate: plan.expireDate,
  };
}

exports._applyUnfreeze = applyUnfreeze;

// Mirrors sendFreezeNotifications' user-facing half -- same "Plan Paused"
// -> "Plan Resumed" pairing Shaista asked for, transactional (no quiet
// hours / preference gate, see PREF_BY_TYPE in helper/notification.js)
// since "you can use your plan again" is time-sensitive, same as the
// pause notice was. Shared by both the manual Unfreeze button
// (unfreezePlan above) and the auto-unfreeze cron
// (helper/autoUnfreezeExpiredPlans.js) -- one implementation, one message,
// regardless of which path actually flips the plan back to active.
async function sendUnfreezeNotification(userId) {
  const user = await User.findByPk(userId);
  if (user?.deviceToken) {
    await sendNotification([user.deviceToken], {
      title: "Plan Resumed",
      body: "Your plan is active again -- book your classes any time.",
    }, { type: "planResumed" });
  }
}

exports._sendUnfreezeNotification = sendUnfreezeNotification;

// POST /users/plan/cancel   body: { userPlanId, reason? }
// Self-service cancellation. Ends the plan immediately (status=false),
// same effect as the admin cancel (AdminController.cancelUserPlan) —
// this is not a "let it run out" flow since the app has no such concept
// today. No refund is issued automatically; that stays a manual/human
// decision on the business side, same as it is today for any other
// refund request.
exports.cancelPlan = async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const userPlanId = Number(req.body.userPlanId);
  if (!Number.isInteger(userPlanId) || userPlanId <= 0) {
    return res.json(ApiResponse("0", "userPlanId must be a positive integer", {}));
  }
  const reason = typeof req.body.reason === "string" ? req.body.reason.slice(0, 500) : null;

  const t = await sequelize.transaction();
  try {
    // Ownership check via userId, not just id — a user must only ever be
    // able to cancel their own plan.
    const plan = await UserPlan.findOne({
      where: { id: userPlanId, userId: req.user.id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!plan) {
      await t.rollback();
      return res.json(ApiResponse("0", "Plan not found", {}));
    }
    if (plan.planStatus === "cancelled") {
      await t.rollback();
      return res.json(ApiResponse("0", "This plan is already cancelled", {}));
    }
    // Shaista's call: cancelling a paused plan is confusing (what date
    // counts, what's refundable, access is already paused) — require an
    // unfreeze first. Enforced here too, not just hidden in the app UI,
    // so a stale screen or a direct API call can't slip past it.
    if (plan.frozenAt) {
      await t.rollback();
      return res.json(
        ApiResponse("0", "Unfreeze your plan before cancelling it", {})
      );
    }

    plan.planStatus = "cancelled";
    plan.cancelledAt = new Date();
    plan.cancelReason = reason;
    plan.cancelledBy = req.user.id;
    await plan.save({ transaction: t });

    // Revoke in-app paid access (User.status — the actual flag the app's
    // home screen gates on, see AdminController.cancelUserPlan for the
    // full explanation) unless the user has another active plan besides
    // this one. UserPlan.status is deliberately left untouched, matching
    // autoExpireUserPlans.js, so this row keeps showing via
    // GET /users/get_user_plans instead of silently disappearing.
    // Same NULL-comparison trap as getActivePlan() above — must allow
    // planStatus IS NULL through explicitly, or this silently treats a
    // perfectly normal, never-touched other plan as if it didn't exist.
    const otherActivePlan = await UserPlan.findOne({
      where: {
        userId: plan.userId,
        id: { [Op.ne]: plan.id },
        [Op.or]: [
          { planStatus: null },
          { planStatus: { [Op.ne]: "cancelled" } },
        ],
        expireDate: { [Op.gt]: new Date() },
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
    return res.json(ApiResponse("1", "Plan cancelled", { userPlanId: plan.id }));
  } catch (error) {
    await t.rollback();
    console.error("[cancelPlan] error:", error);
    return res.status(500).json(ApiResponse("0", "Error cancelling plan", { error: error.message }));
  }
};

// GET /users/plan/freeze-status
exports.freezeStatus = async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  try {
    const plan = await getActivePlan(req.user.id);
    if (!plan) {
      return res.json(
        ApiResponse("1", "Freeze status", {
          hasActivePlan: false,
          isFrozen: false,
          canFreezeNow: false,
          blockedReason: "No active plan",
        })
      );
    }

    const now = new Date();
    let originalDurationDays = plan.originalDurationDays;
    if (originalDurationDays == null && plan.buyingDate && plan.expireDate) {
      // Best-effort hint for the UI before any freeze has snapshotted.
      originalDurationDays = diffDays(plan.expireDate, plan.buyingDate);
    }
    const remainingFreezeBudget = originalDurationDays != null
      ? Math.max(0, originalDurationDays - (plan.totalFrozenDays || 0))
      : null;

    // Same expiry-runway rule freezePlan enforces (days >= daysUntilExpiry
    // is rejected there) -- surfaced here too so the app can show the
    // real, combined max up front instead of a user picking 30 days,
    // hitting Pause, and only then learning it was capped at 4.
    const daysUntilExpiry = diffDays(plan.expireDate, now);
    const maxByExpiry = Math.max(daysUntilExpiry - 1, 0);
    const maxFreezeDaysNow = remainingFreezeBudget != null
      ? Math.min(remainingFreezeBudget, maxByExpiry)
      : maxByExpiry;

    let canFreezeNow = !plan.frozenAt && remainingFreezeBudget !== 0 && maxFreezeDaysNow > 0;
    let blockedReason = null;
    if (plan.frozenAt) {
      canFreezeNow = false;
      blockedReason = "Already frozen";
    } else if (remainingFreezeBudget === 0) {
      blockedReason = "No freeze days remaining on this plan";
    } else if (maxFreezeDaysNow <= 0) {
      blockedReason = "Plan expires too soon to freeze right now";
    }

    return res.json(
      ApiResponse("1", "Freeze status", {
        hasActivePlan: true,
        userPlanId: plan.id,
        isFrozen: !!plan.frozenAt,
        frozenAt: plan.frozenAt,
        freezeDays: plan.freezeDays,
        willResumeOn: plan.frozenAt && plan.freezeDays
          ? shiftDate(plan.frozenAt, plan.freezeDays)
          : null,
        totalFrozenDays: plan.totalFrozenDays || 0,
        originalDurationDays,
        remainingFreezeBudget,
        daysUntilExpiry,
        maxFreezeDaysNow,
        canFreezeNow,
        blockedReason,
      })
    );
  } catch (error) {
    console.error("[freeze-status] error:", error);
    return res.status(500).json(ApiResponse("0", "Error fetching freeze status", { error: error.message }));
  }
};

async function sendFreezeNotifications(userId, days, willResumeOn, cancelledAppts, dietitianIds) {
  const user = await User.findByPk(userId);
  if (user?.deviceToken) {
    await sendNotification([user.deviceToken], {
      title: "Plan Paused",
      body: `Your plan is paused until ${willResumeOn.toISOString().slice(0, 10)}. Resume any time from your profile.`,
    }, { type: "planPaused" });
  }
  if (cancelledAppts.length > 0 && dietitianIds.length > 0) {
    const dietitians = await User.findAll({ where: { id: { [Op.in]: dietitianIds } } });
    for (const d of dietitians) {
      if (d.deviceToken) {
        await sendNotification([d.deviceToken], {
          title: "Appointment Cancelled",
          body: `${user?.firstName ?? "A user"} paused their plan; an upcoming appointment was cancelled.`,
        }, { type: "appointmentCanceled" });
      }
    }
  }
}
