const ApiResponse = require('../../helper/ApiResponse');
const db = require('../../models');
const {
  generateDietPlan,
} = require('../../services/ai/aiDietPlanGenerator');
const {
  saveDraftDietPlan,
  activateDietPlan,
  listPlansForUser,
  listDraftsForDietitian,
  updateMealInPlan,
  cancelDietPlan,
} = require('../../services/dietPlanService');

const VALID_STATUSES = ['draft', 'active', 'completed', 'cancelled'];

const {
  getAssignedClientIds,
  isUnscopedRole,
} = require('../../helper/dietitianScope');

// Scoping guard (same rule as preConsultationAdminController's
// assertOwnsProfile): Admin sees everything; every other staff type may
// only touch plans for clients assigned to her. validateAdmin alone only
// checks "not a plain User" — it never checked WHICH staff member asked,
// so any dietitian/trainer could generate, activate or read another
// dietitian's client's plan by changing an id in the URL.
async function canAccessClient(req, clientUserId) {
  if (isUnscopedRole(req.user && req.user.userType)) return true;
  const assignedIds = await getAssignedClientIds(req.user && req.user.id);
  return assignedIds.has(Number(clientUserId));
}

const { User, PreConsultationProfile, DietPlan, DietPlanDay, DietPlanMeal } = db;

// ── Calorie target estimate ───────────────────────────────────────────
// Moved to services/ai/utils/calorieTarget.js so the trial quick-intake
// path (trialDietPlanController.js) computes targetCalories the exact
// same way instead of carrying its own copy that could drift — same
// reasoning as the shared allergy-keyword parsing in utils/allergies.js.
// Every draft from this controller still goes through the dietitian for
// review before activation.
const { computeTargetCalories, heightFeetToCm } = require('../../services/ai/utils/calorieTarget');

/**
 * POST /admin/diet-plan/generate
 * Body: { userId, userPlanId, planDays = 14, mealsPerDay }
 * Auth: validateAdmin (req.user.userType !== 'User')
 *
 * Composes user input from User + PreConsultationProfile, calls the
 * Vertex AI generator, and persists the result as a draft DietPlan.
 * The dietitian still has to call /:id/activate before the user sees it.
 */
// MariaDB returns JSON columns as raw strings (see the note in
// models/PendingPopupState.js), so parse defensively before use.
function asJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

async function generateDietPlanDraft(req, res) {
  try {
    const {
      userId,
      userPlanId,
      planDays = 14,
      mealsPerDay,
    } = req.body || {};

    if (!userId || !userPlanId) {
      return res.json(
        ApiResponse('0', 'userId and userPlanId are required', {})
      );
    }

    if (!(await canAccessClient(req, userId))) {
      return res.json(ApiResponse('0', 'This client is not assigned to you', {}));
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.json(ApiResponse('0', 'User not found', {}));
    }

    const profile = await PreConsultationProfile.findOne({
      where: { userId },
    });
    if (!profile) {
      return res.json(
        ApiResponse('0', 'User must complete consultation first', {})
      );
    }

    // TODO Phase D: pull most recent UserCycleData for cyclePhase.
    // TODO Phase D: derive cuisinePreference from profile.dietaryPreferences.
    const userInput = {
      id: user.id,
      firstName: user.firstName || 'User',
      age: user.age,
      // weightKg / heightCm — User stores `weight` as a plain kg string
      // and `height` as a decimal-FEET string (legacy schema, e.g.
      // "5.4" = 5.4 ft). heightFeetToCm() converts before use — this
      // used to pass user.height straight through as if it were already
      // centimeters, silently corrupting every BMR/TDEE calc below.
      weightKg: user.weight,
      heightCm: heightFeetToCm(user.height),
      goal: profile.goals || user.mainGoal || 'general wellness',
      cyclePhase: 'follicular',
      hasPcos: ((profile.medicalConditions || '') + ' ' + (user.healthConditions || ''))
        .toLowerCase()
        .includes('pcos'),
      allergies: profile.allergies || '',
      cuisinePreference: 'Pakistani',
      targetCalories: computeTargetCalories({
        weightKg: user.weight,
        heightCm: heightFeetToCm(user.height),
        age: user.age,
        lifestyle: profile.lifestyle,
        goalKey: profile.goals || user.mainGoal,
      }),
      mealsPerDay: mealsPerDay || profile.mealsPerDay || 5,

      // Full pre-consultation form, as last edited by the dietitian
      // during the consultation. Everything below goes to the AI so the
      // plan reflects what was actually agreed in the session.
      pregnancyMenstrualStatus: profile.pregnancyMenstrualStatus || '',
      medicalConditions: profile.medicalConditions || '',
      currentMedications: profile.currentMedications || '',
      dietaryPreferences: asJson(profile.dietaryPreferences, []),
      fastingHabits: profile.fastingHabits || '',
      surgeries: profile.surgeries || '',
      familyHistory: profile.familyHistory || '',
      lifestyle: asJson(profile.lifestyle, {}),
      dietitianNotes: asJson(profile.dietitianComments, [])
        .map((c) => (c && c.text ? String(c.text).trim() : ''))
        .filter(Boolean),
    };

    const result = await generateDietPlan(userInput, planDays, req.user.id);

    if (!result.success) {
      return res.json(
        ApiResponse('0', result.error || 'AI generation failed', {
          validation: result.validation || null,
        })
      );
    }

    const dietPlan = await saveDraftDietPlan({
      userId,
      userPlanId,
      dietitianId: req.user.id,
      aiResult: result.plan,
      planDays,
      mealsPerDay: userInput.mealsPerDay,
      aiGenerationLogId: result.aiGenerationLogId,
    });

    return res.json(ApiResponse('1', 'Draft plan generated', { dietPlan }));
  } catch (err) {
    console.error('[generateDietPlanDraft] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

/**
 * POST /admin/diet-plan/:id/activate
 * Auth: validateAdmin
 */
async function activateDietPlanHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.json(ApiResponse('0', 'Invalid plan id', {}));
    }
    // Only the dietitian who wrote the draft (or an Admin) may send it
    // to the client — same rule cancel/edit already enforce via
    // assertCanMutate in dietPlanService.
    const target = await DietPlan.findByPk(id, {
      attributes: ['id', 'userId', 'dietitianId'],
    });
    if (!target) {
      return res.json(ApiResponse('0', 'Diet plan not found', {}));
    }
    const isAdmin = isUnscopedRole(req.user && req.user.userType);
    if (!isAdmin && target.dietitianId !== req.user.id) {
      return res.json(ApiResponse('0', 'Not authorized to activate this plan', {}));
    }
    const dietPlan = await activateDietPlan(id, req.user.id);
    return res.json(ApiResponse('1', 'Plan activated', { dietPlan }));
  } catch (err) {
    // Service-thrown errors (Plan already active, Cannot activate a
    // closed plan, Diet plan not found) bubble here as 4xx.
    console.error('[activateDietPlanHandler] error:', err.message);
    return res.json(ApiResponse('0', err.message, {}));
  }
}

/**
 * GET /admin/diet-plan/:id
 * Auth: validateAdmin
 */
async function getDietPlanByIdAdmin(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.json(ApiResponse('0', 'Invalid plan id', {}));
    }
    const dietPlan = await DietPlan.findByPk(id, {
      include: [{ model: DietPlanDay, include: [DietPlanMeal] }],
      order: [
        [DietPlanDay, 'dayNumber', 'ASC'],
        [DietPlanDay, DietPlanMeal, 'time', 'ASC'],
      ],
    });
    // Same "not found" reply for someone else's client, so this doesn't
    // confirm to a prober that the plan exists.
    if (!dietPlan || !(await canAccessClient(req, dietPlan.userId))) {
      return res.json(ApiResponse('0', 'Plan not found', {}));
    }
    return res.json(ApiResponse('1', 'Plan', { dietPlan }));
  } catch (err) {
    console.error('[getDietPlanByIdAdmin] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

/**
 * GET /admin/diet-plan/user/:userId/list?status=...
 * Auth: validateAdmin
 */
async function listPlansForUserHandler(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId)) {
      return res.json(ApiResponse('0', 'Invalid userId', {}));
    }
    const status = req.query.status;
    if (status && !VALID_STATUSES.includes(status)) {
      return res.json(
        ApiResponse(
          '0',
          `status must be one of: ${VALID_STATUSES.join(', ')}`,
          {}
        )
      );
    }
    if (!(await canAccessClient(req, userId))) {
      return res.json(ApiResponse('0', 'This client is not assigned to you', {}));
    }
    const plans = await listPlansForUser(userId, { status });
    return res.json(ApiResponse('1', 'Plans for user', { plans }));
  } catch (err) {
    console.error('[listPlansForUserHandler] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

/**
 * GET /admin/diet-plan/drafts
 * Auth: validateAdmin
 *
 * The dietitian's "pending review" feed — every draft they authored,
 * with the target user + days + meals eager-loaded.
 */
async function listMyDraftsHandler(req, res) {
  try {
    const plans = await listDraftsForDietitian(req.user.id);
    return res.json(ApiResponse('1', 'Your drafts', { plans }));
  } catch (err) {
    console.error('[listMyDraftsHandler] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

/**
 * PATCH /admin/diet-plan/meal/:mealId
 * Body: { foodName?, calories?, time?, notes?, mealType? }
 * Auth: validateAdmin
 */
async function updateMealHandler(req, res) {
  try {
    const mealId = parseInt(req.params.mealId, 10);
    if (!Number.isInteger(mealId)) {
      return res.json(ApiResponse('0', 'Invalid mealId', {}));
    }
    const allowedKeys = ['foodName', 'calories', 'time', 'notes', 'mealType'];
    const fields = {};
    for (const k of allowedKeys) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) {
        fields[k] = req.body[k];
      }
    }
    if (Object.keys(fields).length === 0) {
      return res.json(
        ApiResponse('0', 'At least one field must be provided', {})
      );
    }
    const result = await updateMealInPlan(mealId, fields, req.user.id);
    return res.json(ApiResponse('1', 'Meal updated', result));
  } catch (err) {
    // Service-thrown validation errors land here as 200 with status="0"
    // (matches the codebase convention — controllers don't 4xx).
    console.error('[updateMealHandler] error:', err.message);
    return res.json(ApiResponse('0', err.message, {}));
  }
}

/**
 * POST /admin/diet-plan/:id/cancel
 * Body: { reason? }
 * Auth: validateAdmin
 */
async function cancelPlanHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) {
      return res.json(ApiResponse('0', 'Invalid plan id', {}));
    }
    const reason = req.body && req.body.reason ? String(req.body.reason) : null;
    const dietPlan = await cancelDietPlan(id, req.user.id, reason);
    return res.json(ApiResponse('1', 'Plan cancelled', { dietPlan }));
  } catch (err) {
    console.error('[cancelPlanHandler] error:', err.message);
    return res.json(ApiResponse('0', err.message, {}));
  }
}

/**
 * GET /admin/diet-plan/user/:userId/meal-activity?days=7
 * Auth: validateAdmin + scoped to the dietitian's own clients.
 *
 * How actively she logged her meals over the last N days (default 7,
 * max 31), one entry per day, oldest first:
 *   { date, planned, followed, alternative, skipped, logged }
 * `planned` = mealsPerDay of the plan she was on that day (0 if no plan
 * covered that day). Dates are Pakistan-time calendar days, same as the
 * client app's meal log.
 */
async function getClientMealActivity(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId)) {
      return res.json(ApiResponse('0', 'Invalid userId', {}));
    }
    if (!(await canAccessClient(req, userId))) {
      return res.json(ApiResponse('0', 'This client is not assigned to you', {}));
    }
    const moment = require('moment-timezone');
    const { Op } = db.Sequelize;
    const TZ = 'Asia/Karachi';
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 31);
    const today = moment.tz(TZ).startOf('day');
    const start = today.clone().subtract(days - 1, 'days');
    const fromStr = start.format('YYYY-MM-DD');
    const toStr = today.format('YYYY-MM-DD');

    const [logs, plans] = await Promise.all([
      db.MealLog.findAll({
        where: { userId, date: { [Op.between]: [fromStr, toStr] } },
        attributes: ['date', 'status'],
        raw: true,
      }),
      DietPlan.findAll({
        where: {
          userId,
          activatedAt: { [Op.ne]: null },
          status: { [Op.ne]: 'cancelled' },
        },
        attributes: ['activatedAt', 'planDays', 'mealsPerDay'],
        raw: true,
      }),
    ]);

    const out = [];
    for (let i = 0; i < days; i++) {
      const d = start.clone().add(i, 'days');
      const key = d.format('YYYY-MM-DD');
      let planned = 0;
      for (const p of plans) {
        const first = moment.tz(p.activatedAt, TZ).startOf('day');
        const last = first.clone().add((p.planDays || 0) - 1, 'days');
        if (!d.isBefore(first) && !d.isAfter(last)) {
          planned = Math.max(planned, p.mealsPerDay || 0);
        }
      }
      const dayLogs = logs.filter((l) => String(l.date).slice(0, 10) === key);
      const followed = dayLogs.filter((l) => l.status === 'followed').length;
      const alternative = dayLogs.filter((l) => l.status === 'alternative').length;
      const skipped = dayLogs.filter((l) => l.status === 'skipped').length;
      out.push({
        date: key,
        planned,
        followed,
        alternative,
        skipped,
        logged: followed + alternative + skipped,
      });
    }

    return res.json(
      ApiResponse('1', 'Meal activity', { from: fromStr, to: toStr, days: out })
    );
  } catch (err) {
    console.error('[getClientMealActivity] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

/**
 * POST /admin/diet-plan/user-plan/:userPlanId/reset-booking-pass
 * Auth: validateAdmin + scoped to the dietitian's own clients.
 *
 * Gives a client her free late change back and unlocks self-booking
 * (consultation change policy, helper/bookingPolicy.js) — e.g. after
 * staff have talked to her about a missed session.
 */
async function resetBookingPassHandler(req, res) {
  try {
    const id = parseInt(req.params.userPlanId, 10);
    if (!Number.isInteger(id)) {
      return res.json(ApiResponse('0', 'Invalid userPlanId', {}));
    }
    const plan = await db.UserPlan.findByPk(id);
    if (!plan) return res.json(ApiResponse('0', 'Package not found', {}));
    if (!(await canAccessClient(req, plan.userId))) {
      return res.json(ApiResponse('0', 'This client is not assigned to you', {}));
    }
    plan.lateChangeUsedAt = null;
    plan.bookingLockedAt = null;
    await plan.save();
    return res.json(
      ApiResponse('1', 'Booking pass reset. She can book and make one late change again.', {
        userPlanId: plan.id,
      })
    );
  } catch (err) {
    console.error('[resetBookingPassHandler] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

module.exports = {
  generateDietPlanDraft,
  activateDietPlanHandler,
  getDietPlanByIdAdmin,
  listPlansForUserHandler,
  listMyDraftsHandler,
  updateMealHandler,
  cancelPlanHandler,
  getClientMealActivity,
  resetBookingPassHandler,
};
