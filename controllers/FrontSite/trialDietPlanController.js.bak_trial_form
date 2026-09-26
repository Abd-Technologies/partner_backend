// Trial-to-Plan funnel — Steps 3, 4, 5 in one call:
//   3. Quick nutrition intake (goal, allergies, meals/day) — a trimmed
//      subset of the full dietitian-facing PreConsultationProfile form.
//   4. Auto-generate a starter plan via the same AI service the
//      dietitian's admin flow uses (services/ai/aiDietPlanGenerator.js),
//      but server-triggered: dietitianId is null throughout.
//   5. Auto-activate immediately — no dietitian review step for the
//      trial's starter plan.
//
// One-shot by design (per the funnel's "Leaning" decision): a trial user
// who already has a DietPlan doesn't get a second one from this
// endpoint. Defaults: mealsPerDay 4, planDays 7 (independent of the
// 3-day live-class trial countdown).
const ApiResponse = require('../../helper/ApiResponse');
const db = require('../../models');
const { generateDietPlan } = require('../../services/ai/aiDietPlanGenerator');
const {
  saveDraftDietPlan,
  activateDietPlan,
} = require('../../services/dietPlanService');
const { ensureTrialUserPlan } = require('../../services/trialPlanService');
const { computeTargetCalories, heightFeetToCm } = require('../../services/ai/utils/calorieTarget');

const { User, PreConsultationProfile, DietPlan, TrialJourney } = db;

const DEFAULT_TRIAL_MEALS_PER_DAY = 4;
const TRIAL_PLAN_DAYS = 7;
const VALID_MEALS_PER_DAY = [3, 4, 5, 6];

/**
 * POST /trial/quick-intake
 * Body: { goal, allergies?, mealsPerDay? }
 * Auth: validateToken (logged-in user)
 */
async function submitTrialQuickIntake(req, res) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.json(ApiResponse('0', 'User not loggedIn!', {}));
    }

    // Must have actually started the (live-class) trial first — this
    // endpoint is the second step of that same funnel, not a standalone
    // "get a free plan" door.
    const journey = await TrialJourney.findOne({ where: { userId } });
    if (!journey) {
      return res.json(ApiResponse('0', 'Start your free trial first', {}));
    }

    const { goal, allergies, mealsPerDay } = req.body || {};
    if (!goal || !String(goal).trim()) {
      return res.json(ApiResponse('0', 'Please tell us your main goal', {}));
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.json(ApiResponse('0', 'User not found', {}));
    }

    // One-shot: a trial user who already has a plan (any status) doesn't
    // get a second one from this endpoint.
    const existingPlan = await DietPlan.findOne({ where: { userId } });
    if (existingPlan) {
      return res.json(
        ApiResponse('0', "You've already got a plan", {
          dietPlanId: existingPlan.id,
        })
      );
    }

    const trialUserPlan = await ensureTrialUserPlan(userId);

    const resolvedMealsPerDay = VALID_MEALS_PER_DAY.includes(Number(mealsPerDay))
      ? Number(mealsPerDay)
      : DEFAULT_TRIAL_MEALS_PER_DAY;

    let profile = await PreConsultationProfile.findOne({ where: { userId } });
    const profileFields = {
      userId,
      goals: String(goal).trim(),
      allergies:
        allergies != null && String(allergies).trim() !== ''
          ? String(allergies).trim()
          : (profile ? profile.allergies : null),
      mealsPerDay: resolvedMealsPerDay,
      // Marks this as the trimmed trial form, not the full consultation
      // — see PreConsultationProfile.js's intakeSource comment.
      intakeSource: 'trial_quick',
      isComplete: true,
      lastUserUpdate: new Date(),
    };

    if (profile) {
      await profile.update(profileFields);
    } else {
      profile = await PreConsultationProfile.create(profileFields);
    }

    const userInput = {
      id: user.id,
      firstName: user.firstName || 'User',
      age: user.age,
      // heightFeetToCm() converts User.height (stored as decimal FEET,
      // e.g. "5.4" = 5.4 ft — legacy schema) to real centimeters. This
      // used to pass the raw feet value straight through as if it were
      // already cm, silently corrupting every BMR/TDEE calc below.
      weightKg: user.weight,
      heightCm: heightFeetToCm(user.height),
      goal: profile.goals,
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
        goalKey: profile.goals,
      }),
      mealsPerDay: resolvedMealsPerDay,
    };

    // dietitianId: null throughout — server-triggered, not staff-triggered.
    const result = await generateDietPlan(userInput, TRIAL_PLAN_DAYS, null);
    if (!result.success) {
      return res.json(
        ApiResponse('0', result.error || 'Could not generate your plan yet — please try again', {
          validation: result.validation || null,
        })
      );
    }

    const draft = await saveDraftDietPlan({
      userId,
      userPlanId: trialUserPlan.id,
      dietitianId: null,
      aiResult: result.plan,
      planDays: TRIAL_PLAN_DAYS,
      mealsPerDay: resolvedMealsPerDay,
      aiGenerationLogId: result.aiGenerationLogId,
    });

    // Step 5 — auto-activate immediately, no dietitian review.
    const activated = await activateDietPlan(draft.id, null);

    return res.json(
      ApiResponse('1', 'Your simple plan is ready!', { dietPlan: activated })
    );
  } catch (err) {
    console.error('[submitTrialQuickIntake] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

module.exports = { submitTrialQuickIntake };
