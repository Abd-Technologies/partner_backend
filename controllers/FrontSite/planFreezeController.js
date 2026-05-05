const { Op } = require("sequelize");
const { UserPlan, Appointment, User, sequelize } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const sendNotification = require("../../helper/notification");

// User-button freeze flow. Decisions baked in (see docs/Freeze_Logic_Audit.md):
//   • Unlimited freezes per plan
//   • Cumulative cap = original plan duration in days
//   • 1-day cooldown after unfreeze before user can freeze again
//   • Auto-cancel pending/confirmed/In-Progress appointments inside the
//     freeze window, with FCM to user and dietitian
//   • Auto-unfreeze cron flips back to active when frozenAt + freezeDays
//     elapses (sets unfrozenBy = NULL as the audit signal for cron-driven)

const COOLDOWN_DAYS = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Picks the user's currently-active plan. "Active" = expireDate in the
// future. If multiple, return the one expiring latest (typically the
// freshest purchase). Returns null if no active plan.
async function getActivePlan(userId, transaction) {
  return UserPlan.findOne({
    where: {
      userId,
      expireDate: { [Op.gt]: new Date() },
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

    // Cooldown check — using lastUnfrozenAt, not the legacy User.updatedAt
    // (which any save mutates and so was unreliable in the v1 flow).
    if (plan.lastUnfrozenAt) {
      const cooldownEnds = shiftDate(plan.lastUnfrozenAt, COOLDOWN_DAYS);
      if (cooldownEnds > new Date()) {
        await t.rollback();
        return res.json(
          ApiResponse(
            "0",
            `Please wait until ${cooldownEnds.toISOString().slice(0, 10)} before freezing again (1-day cooldown).`,
            {}
          )
        );
      }
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

    let canFreezeNow = !plan.frozenAt && remainingFreezeBudget !== 0;
    let blockedReason = null;
    if (plan.frozenAt) {
      canFreezeNow = false;
      blockedReason = "Already frozen";
    } else if (plan.lastUnfrozenAt) {
      const cooldownEnds = shiftDate(plan.lastUnfrozenAt, COOLDOWN_DAYS);
      if (cooldownEnds > now) {
        canFreezeNow = false;
        blockedReason = `Cooldown until ${cooldownEnds.toISOString().slice(0, 10)}`;
      }
    } else if (remainingFreezeBudget === 0) {
      blockedReason = "No freeze days remaining on this plan";
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
        cooldownDays: COOLDOWN_DAYS,
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
    });
  }
  if (cancelledAppts.length > 0 && dietitianIds.length > 0) {
    const dietitians = await User.findAll({ where: { id: { [Op.in]: dietitianIds } } });
    for (const d of dietitians) {
      if (d.deviceToken) {
        await sendNotification([d.deviceToken], {
          title: "Appointment Cancelled",
          body: `${user?.firstName ?? "A user"} paused their plan; an upcoming appointment was cancelled.`,
        });
      }
    }
  }
}
