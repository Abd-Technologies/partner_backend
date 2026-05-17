const db = require('../models');
const sendNotification = require('../helper/notification');
const {
  VALID_MEAL_TYPES,
} = require('./ai/constants/mealTemplates');

const { DietPlan, DietPlanDay, DietPlanMeal, User, UserPlan } = db;
const { Op } = db.Sequelize;

const TIME_PATTERN = /^\d{2}:\d{2}$/;
const EDITABLE_STATUSES = ['draft', 'active'];

/**
 * Persist a freshly-generated AI diet plan as a draft.
 *
 * Wraps DietPlan + DietPlanDay × N + DietPlanMeal × N×M inserts in a
 * single Sequelize transaction so a partial failure can't leave the DB
 * with orphaned days. Returns the saved DietPlan with `DietPlanDays`
 * (each with `DietPlanMeals`) eager-loaded.
 *
 * @param {object} args
 * @param {number} args.userId             Target user.
 * @param {number} args.userPlanId         Active UserPlan this diet attaches to.
 * @param {number|null} args.dietitianId   Caller (the dietitian).
 * @param {object} args.aiResult           `result.plan` from generateDietPlan
 *                                         (shape: { summary, days[].meals[] }).
 * @param {number} args.planDays
 * @param {number} args.mealsPerDay
 * @param {number|null} args.aiGenerationLogId
 * @returns {Promise<DietPlan>}            Saved plan with eager-loaded children.
 */
async function saveDraftDietPlan({
  userId,
  userPlanId,
  dietitianId = null,
  aiResult,
  planDays,
  mealsPerDay,
  aiGenerationLogId = null,
}) {
  if (!aiResult || !Array.isArray(aiResult.days)) {
    throw new Error('saveDraftDietPlan: aiResult.days must be an array');
  }

  return db.sequelize.transaction(async (t) => {
    const plan = await DietPlan.create(
      {
        userId,
        userPlanId,
        dietitianId,
        aiGenerationLogId,
        planDays,
        mealsPerDay,
        status: 'draft',
        summary: aiResult.summary || null,
      },
      { transaction: t }
    );

    for (const day of aiResult.days) {
      const dayRow = await DietPlanDay.create(
        {
          dietPlanId: plan.id,
          dayNumber: day.dayNumber,
          totalCalories: day.totalCalories,
        },
        { transaction: t }
      );

      const mealRows = (day.meals || []).map((m) => ({
        dietPlanDayId: dayRow.id,
        mealType: m.mealType,
        time: m.time,
        foodName: m.foodName,
        calories: m.calories,
        notes: m.notes || null,
      }));
      if (mealRows.length) {
        await DietPlanMeal.bulkCreate(mealRows, { transaction: t });
      }
    }

    // Re-fetch with eager-loaded children inside the transaction so the
    // caller gets a complete object without a separate round-trip.
    return DietPlan.findByPk(plan.id, {
      include: [
        {
          model: DietPlanDay,
          include: [DietPlanMeal],
        },
      ],
      order: [
        [DietPlanDay, 'dayNumber', 'ASC'],
        [DietPlanDay, DietPlanMeal, 'time', 'ASC'],
      ],
      transaction: t,
    });
  });
}

/**
 * Stamp the cycle anchors on the parent UserPlan so consultation-flow
 * popups (Day 7 review, Day 15 / 30 progress) fire at the right offsets.
 * Mirrors `stampPlanDeliveryAnchors` in controllers/Admin/AdminController.js.
 * Idempotent + safe on missing rows.
 */
async function stampPlanDeliveryAnchors(userPlanId, transaction) {
  if (!userPlanId) return;
  const userPlan = await UserPlan.findByPk(userPlanId, { transaction });
  if (!userPlan) return;

  const now = new Date();
  const updates = { latestPlanDeliveredAt: now };

  if (!userPlan.firstPlanDeliveredAt) {
    updates.firstPlanDeliveredAt = now;
    updates.cycle1StartedAt = now;
  } else if (!userPlan.cycle2StartedAt) {
    updates.cycle2StartedAt = now;
  }

  await userPlan.update(updates, { transaction });
}

/**
 * Activate a draft diet plan. Closes any other 'active' plan for the
 * same user (data-integrity cleanup), stamps cycle anchors on the
 * parent UserPlan, and pushes a notification to the user.
 *
 * @param {number} dietPlanId
 * @param {number|null} dietitianId  Caller — for completeness; not stored.
 * @returns {Promise<DietPlan>}      The activated plan with children.
 * @throws on missing/closed plans.
 */
async function activateDietPlan(dietPlanId, dietitianId = null) {
  const plan = await db.sequelize.transaction(async (t) => {
    const target = await DietPlan.findByPk(dietPlanId, { transaction: t });
    if (!target) throw new Error('Diet plan not found');

    if (target.status === 'active') {
      throw new Error('Plan already active');
    }
    if (target.status === 'completed' || target.status === 'cancelled') {
      throw new Error('Cannot activate a closed plan');
    }
    if (target.status !== 'draft') {
      throw new Error(`Cannot activate plan with status "${target.status}"`);
    }

    // Close any stragglers — should be 0 or 1 in a well-behaved DB,
    // but `where: { status: 'active', userId }` is the safety net for
    // historical data corruption (Phase C edge case spec).
    const now = new Date();
    await DietPlan.update(
      { status: 'completed', completedAt: now },
      {
        where: { userId: target.userId, status: 'active' },
        transaction: t,
      }
    );

    target.status = 'active';
    target.activatedAt = now;
    await target.save({ transaction: t });

    // Cycle anchors — fire-and-forget within the txn. Failures are
    // non-fatal because the user already sees the plan as active.
    try {
      await stampPlanDeliveryAnchors(target.userPlanId, t);
    } catch (e) {
      console.error('[activateDietPlan] anchor stamp failed:', e.message);
    }

    return DietPlan.findByPk(target.id, {
      include: [{ model: DietPlanDay, include: [DietPlanMeal] }],
      order: [
        [DietPlanDay, 'dayNumber', 'ASC'],
        [DietPlanDay, DietPlanMeal, 'time', 'ASC'],
      ],
      transaction: t,
    });
  });

  // Push notification — outside the txn so a delivery failure doesn't
  // roll back activation. Mirrors addDietPdf's pattern.
  try {
    const user = await User.findByPk(plan.userId);
    if (user && user.deviceToken) {
      sendNotification([user.deviceToken], {
        title: 'Your Diet Plan is Ready',
        body: 'Your dietitian has activated your personalized plan.',
      });
    }
  } catch (e) {
    console.error('[activateDietPlan] notification failed:', e.message);
  }

  return plan;
}

/**
 * Most recent 'active' diet plan for a user, with days+meals eager-loaded.
 * Returns null when the user has no active plan (so callers can render
 * a "no plan yet" state without try/catch).
 *
 * @param {number} userId
 * @returns {Promise<DietPlan|null>}
 */
async function getActiveDietPlanForUser(userId) {
  return DietPlan.findOne({
    where: { userId, status: 'active' },
    include: [{ model: DietPlanDay, include: [DietPlanMeal] }],
    order: [
      ['activatedAt', 'DESC'],
      [DietPlanDay, 'dayNumber', 'ASC'],
      [DietPlanDay, DietPlanMeal, 'time', 'ASC'],
    ],
  });
}

/**
 * All diet plans for a user, optionally filtered by status.
 * Eager-loads days+meals so the dietitian's "history" view doesn't need
 * a follow-up call. Returns `[]` for users with no plans (never errors
 * for the empty case).
 *
 * @param {number} userId
 * @param {{ status?: 'draft'|'active'|'completed'|'cancelled' }} [opts]
 * @returns {Promise<DietPlan[]>}
 */
async function listPlansForUser(userId, opts = {}) {
  const where = { userId };
  if (opts.status) where.status = opts.status;
  return DietPlan.findAll({
    where,
    include: [{ model: DietPlanDay, include: [DietPlanMeal] }],
    order: [
      ['createdAt', 'DESC'],
      [DietPlanDay, 'dayNumber', 'ASC'],
      [DietPlanDay, DietPlanMeal, 'time', 'ASC'],
    ],
  });
}

/**
 * Drafts authored by `dietitianId` (status: draft) — drives the
 * dietitian's "pending review" dashboard. Eager-loads the target user
 * (basic identity fields) plus days+meals.
 *
 * @param {number} dietitianId
 * @returns {Promise<DietPlan[]>}
 */
async function listDraftsForDietitian(dietitianId) {
  return DietPlan.findAll({
    where: { dietitianId, status: 'draft' },
    include: [
      {
        model: User,
        attributes: ['id', 'firstName', 'lastName', 'image'],
      },
      { model: DietPlanDay, include: [DietPlanMeal] },
    ],
    order: [
      ['createdAt', 'DESC'],
      [DietPlanDay, 'dayNumber', 'ASC'],
      [DietPlanDay, DietPlanMeal, 'time', 'ASC'],
    ],
  });
}

/**
 * Verify the caller is allowed to mutate this plan. The dietitian who
 * authored the plan can edit it; an Admin role bypasses the ownership
 * check (so support can fix things mid-plan). Anything else throws.
 *
 * Throws with a friendly message on denial — controllers map straight
 * to ApiResponse('0', err.message, {}).
 */
async function assertCanMutate(plan, callerUserId) {
  if (callerUserId == null) return; // null = explicit "skip" (smoke tests)
  if (plan.dietitianId && plan.dietitianId === callerUserId) return;
  const caller = await User.findByPk(callerUserId);
  if (caller && caller.userType === 'Admin') return;
  throw new Error('Not authorized to edit this plan');
}

/**
 * Edit a single meal inside a (draft|active) plan. Composite-unique
 * `(dietPlanDayId, mealType)` is enforced both at the DB level (Phase B
 * migration) and here with a friendlier error message before the
 * UPDATE fires. If `calories` changes, the parent day's `totalCalories`
 * is recomputed from all meals and persisted in the same transaction.
 *
 * @param {number} mealId
 * @param {{ foodName?: string, calories?: number, time?: string,
 *           notes?: string, mealType?: string }} fields
 * @param {number|null} callerUserId  Pass null in trusted internal
 *                                    contexts (smoke tests) to skip the
 *                                    ownership check.
 * @returns {Promise<{ meal: DietPlanMeal, day: DietPlanDay }>}
 */
async function updateMealInPlan(mealId, fields, callerUserId) {
  if (!fields || Object.keys(fields).length === 0) {
    throw new Error('At least one field must be provided');
  }
  // Whitelist + validate.
  const updates = {};
  if (fields.foodName !== undefined) {
    if (typeof fields.foodName !== 'string' || !fields.foodName.trim()) {
      throw new Error('foodName must be a non-empty string');
    }
    updates.foodName = fields.foodName.trim();
  }
  if (fields.calories !== undefined) {
    const c = Number(fields.calories);
    if (!Number.isInteger(c) || c <= 0) {
      throw new Error('calories must be a positive integer');
    }
    updates.calories = c;
  }
  if (fields.time !== undefined) {
    if (typeof fields.time !== 'string' || !TIME_PATTERN.test(fields.time)) {
      throw new Error('time must match HH:MM');
    }
    updates.time = fields.time;
  }
  if (fields.notes !== undefined) {
    if (fields.notes !== null && typeof fields.notes !== 'string') {
      throw new Error('notes must be a string or null');
    }
    updates.notes = fields.notes;
  }
  if (fields.mealType !== undefined) {
    if (!VALID_MEAL_TYPES.includes(fields.mealType)) {
      throw new Error(
        `mealType must be one of: ${VALID_MEAL_TYPES.join(', ')}`
      );
    }
    updates.mealType = fields.mealType;
  }

  return db.sequelize.transaction(async (t) => {
    const meal = await DietPlanMeal.findByPk(mealId, {
      include: [{ model: DietPlanDay, include: [DietPlan] }],
      transaction: t,
    });
    if (!meal) throw new Error('Meal not found');
    const day = meal.DietPlanDay;
    const plan = day && day.DietPlan;
    if (!plan) throw new Error('Meal is missing its parent plan');

    if (!EDITABLE_STATUSES.includes(plan.status)) {
      throw new Error('Plan is closed and cannot be edited');
    }

    await assertCanMutate(plan, callerUserId);

    // Composite-unique guard: if mealType is changing AND another meal
    // on the same day already has that type, surface a clear error
    // before the UPDATE blows up on the unique index.
    if (updates.mealType && updates.mealType !== meal.mealType) {
      const conflict = await DietPlanMeal.findOne({
        where: {
          dietPlanDayId: meal.dietPlanDayId,
          mealType: updates.mealType,
          id: { [Op.ne]: meal.id },
        },
        transaction: t,
      });
      if (conflict) {
        throw new Error(`Day already has a ${updates.mealType} meal`);
      }
    }

    // Track whether we need to recompute the day total.
    const caloriesChanged =
      updates.calories !== undefined && updates.calories !== meal.calories;

    await meal.update(updates, { transaction: t });

    if (caloriesChanged) {
      const sum = await DietPlanMeal.sum('calories', {
        where: { dietPlanDayId: meal.dietPlanDayId },
        transaction: t,
      });
      await day.update({ totalCalories: sum || 0 }, { transaction: t });
    }

    // Re-fetch fresh rows (with the new totalCalories) to return.
    const freshMeal = await DietPlanMeal.findByPk(mealId, { transaction: t });
    const freshDay = await DietPlanDay.findByPk(day.id, { transaction: t });
    return { meal: freshMeal, day: freshDay };
  });
}

/**
 * Cancel a plan. Only draft + active plans are cancellable; completed
 * ones are immutable archives. The reason (when given) is appended to
 * the plan's `summary` field with a `[CANCELLED]:` marker — we don't
 * have a dedicated audit column for cancellations and the spec wants
 * non-destructive append.
 *
 * @param {number} dietPlanId
 * @param {number|null} callerUserId  Same null-skip semantics as updateMealInPlan.
 * @param {string|null} [reason]
 * @returns {Promise<DietPlan>}
 */
async function cancelDietPlan(dietPlanId, callerUserId, reason) {
  return db.sequelize.transaction(async (t) => {
    const plan = await DietPlan.findByPk(dietPlanId, { transaction: t });
    if (!plan) throw new Error('Diet plan not found');

    if (plan.status === 'cancelled') {
      throw new Error('Plan already cancelled');
    }
    if (plan.status === 'completed') {
      throw new Error('Cannot cancel a completed plan');
    }

    await assertCanMutate(plan, callerUserId);

    plan.status = 'cancelled';
    plan.cancelledAt = new Date();
    if (reason && typeof reason === 'string' && reason.trim()) {
      const trimmed = reason.trim().slice(0, 500);
      plan.summary = (plan.summary ? plan.summary + '\n' : '') +
        `[CANCELLED]: ${trimmed}`;
    }
    await plan.save({ transaction: t });

    return DietPlan.findByPk(plan.id, {
      include: [{ model: DietPlanDay, include: [DietPlanMeal] }],
      order: [
        [DietPlanDay, 'dayNumber', 'ASC'],
        [DietPlanDay, DietPlanMeal, 'time', 'ASC'],
      ],
      transaction: t,
    });
  });
}

module.exports = {
  saveDraftDietPlan,
  activateDietPlan,
  getActiveDietPlanForUser,
  listPlansForUser,
  listDraftsForDietitian,
  updateMealInPlan,
  cancelDietPlan,
};
