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

const { User, PreConsultationProfile, DietPlan, DietPlanDay, DietPlanMeal } = db;

/**
 * POST /admin/diet-plan/generate
 * Body: { userId, userPlanId, planDays = 7, mealsPerDay }
 * Auth: validateAdmin (req.user.userType !== 'User')
 *
 * Composes user input from User + PreConsultationProfile, calls the
 * Vertex AI generator, and persists the result as a draft DietPlan.
 * The dietitian still has to call /:id/activate before the user sees it.
 */
async function generateDietPlanDraft(req, res) {
  try {
    const {
      userId,
      userPlanId,
      planDays = 7,
      mealsPerDay,
    } = req.body || {};

    if (!userId || !userPlanId) {
      return res.json(
        ApiResponse('0', 'userId and userPlanId are required', {})
      );
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
    // TODO Phase D: compute targetCalories from goal/weight/activity.
    const userInput = {
      id: user.id,
      firstName: user.firstName || 'User',
      age: user.age,
      // weightKg / heightCm — User stores `weight` and `height` as STRING
      // (legacy schema). The AI prompt treats them as numbers; let the
      // prompt builder coerce / Gemini accept the value as-is.
      weightKg: user.weight,
      heightCm: user.height,
      goal: user.mainGoal || 'general wellness',
      cyclePhase: 'follicular',
      hasPcos: ((profile.medicalConditions || '') + ' ' + (user.healthConditions || ''))
        .toLowerCase()
        .includes('pcos'),
      allergies: profile.allergies || '',
      cuisinePreference: 'Pakistani',
      targetCalories: 1500,
      mealsPerDay: mealsPerDay || profile.mealsPerDay || 5,
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
    if (!dietPlan) {
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

module.exports = {
  generateDietPlanDraft,
  activateDietPlanHandler,
  getDietPlanByIdAdmin,
  listPlansForUserHandler,
  listMyDraftsHandler,
  updateMealHandler,
  cancelPlanHandler,
};
