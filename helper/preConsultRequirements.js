/**
 * Pre-consultation form: which steps a woman still has to answer.
 * One source of truth for the app (GET /users/pre-consultation/requirements)
 * and for the popup that asks paid clients to fill it.
 *
 * Steps (in order):
 *   goal        User.mainGoal and profile.goals both empty
 *   lifeStage   profile.pregnancyMenstrualStatus empty
 *   cycle       she has periods and never answered the cycle question
 *   conditions  User.healthConditions empty ("none" counts as answered)
 *   health      diet plans: allergies empty
 *   food        diet plans: diet type or meals a day missing
 *   dietitian   diet plans: medicines / family history / surgeries (optional)
 *   workout     workout plans: fitness level missing
 *   review      always last (consent tick + confirm)
 *
 * "required" is what makes the form show up for paid clients.
 */
const { Op } = require("sequelize");
const { PreConsultationProfile, User, UserCycleData, UserPlan, Plan } = require("../models");
const { planTypeOf } = require("./planKind");

/**
 * ONE truth for "which questions": her live PAID packages decide it.
 *   diet only → "diet" · workout only → "workout" · both / combined → "combined"
 * Free-trial system plans don't count. null = no paid package.
 * Used by the form popup, GET /requirements and the booking gate, so the
 * app never chooses the question set itself.
 */
async function planTypeForUser(userId) {
  const plans = await UserPlan.findAll({
    where: { userId, status: true, expireDate: { [Op.gte]: new Date() } },
    include: [{ model: Plan, attributes: ["id", "title", "CategoryId", "planType"] }],
  });
  let diet = false;
  let workout = false;
  for (const up of plans) {
    if (up.isTrial) continue;
    const p = up.Plan;
    if (!p) continue;
    const title = String(p.title || "").toLowerCase();
    if (title.startsWith("system") || title === "free trial") continue;
    // planType, then category, then title (helper/planKind.js). A paid
    // plan we can't type gets the full form (diet + workout questions).
    const type = planTypeOf(p) || "combined";
    if (type === "diet" || type === "combined") diet = true;
    if (type === "workout" || type === "combined") workout = true;
  }
  if (diet && workout) return "combined";
  if (diet) return "diet";
  if (workout) return "workout";
  return null;
}

const HAS_PERIODS = ["regular_cycle", "irregular_cycle", "trying_to_conceive"];

function asJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function blank(v) {
  return v == null || String(v).trim() === "";
}

/** planType: "diet" | "workout" | "combined" */
async function requirementsFor(userId, planType = "diet") {
  const [profile, user, cycle] = await Promise.all([
    PreConsultationProfile.findOne({ where: { userId } }),
    User.findByPk(userId, {
      attributes: ["id", "mainGoal", "healthConditions", "age", "weight", "height", "targetWeightKg"],
    }),
    UserCycleData.findOne({ where: { userId } }),
  ]);
  const p = profile || {};
  const ws = asJson(p.workoutSection, {}) || {};
  const steps = asJson(p.stepsCompleted, {}) || {};
  const diet = planType === "diet" || planType === "combined";
  const workout = planType === "workout" || planType === "combined";

  const required = [];
  if (blank(user && user.mainGoal) && blank(p.goals)) required.push("goal");
  if (blank(p.pregnancyMenstrualStatus)) required.push("lifeStage");
  if (
    HAS_PERIODS.includes(p.pregnancyMenstrualStatus) &&
    (!cycle || cycle.dataProvided == null)
  ) {
    required.push("cycle");
  }
  // Oct 2026: an answer from the trial form (profile.medicalConditions)
  // counts too, so trial users who answered there aren't asked again.
  if (blank(user && user.healthConditions) && blank(p.medicalConditions)) required.push("conditions");
  if (diet && blank(p.allergies)) required.push("health");
  const prefs = asJson(p.dietaryPreferences, []);
  if (diet && (!Array.isArray(prefs) || prefs.length === 0 || p.mealsPerDay == null)) {
    required.push("food");
  }
  if (workout && blank(ws.fitnessLevel)) required.push("workout");

  // Optional step: only offered if she never answered or skipped it.
  const optional = [];
  const dietitianEmpty =
    blank(p.currentMedications) && blank(p.familyHistory) && blank(p.surgeries);
  if (diet && dietitianEmpty && !steps.history) optional.push("dietitian");

  // "About you" on the app's profile card (Oct 2026): sign-up body answers
  // still empty. Kept out of "required" so booking and the form popup are
  // unchanged. Target weight is optional, so it is reported on its own.
  const num = (v, lo, hi) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= lo && n <= hi;
  };
  const aboutMissing = [];
  if (blank(user && user.mainGoal)) aboutMissing.push("goal");
  if (!num(user && user.age, 18, 70)) aboutMissing.push("age");
  if (!num(user && user.weight, 30, 150)) aboutMissing.push("weight");
  if (!num(user && user.height, 3, 7)) aboutMissing.push("height");
  const goal = String((user && user.mainGoal) || "").toLowerCase();
  const targetMissing =
    (goal.includes("lose") || goal.includes("gain")) && (user == null || user.targetWeightKg == null);

  const needsConsent = !p.healthConsentAt;
  // Answers carried over from the free trial are confirmed once by a
  // paying client, even if nothing is missing.
  const fromTrial = String(p.intakeSource || "").startsWith("trial");
  const needsConfirm = !p.isComplete || fromTrial;

  const order = ["goal", "lifeStage", "cycle", "conditions", "health", "food", "dietitian", "workout"];
  const all = new Set([...required, ...optional]);
  const show = order.filter((s) => all.has(s));

  return {
    planType,
    required,
    optional,
    aboutMissing,
    targetMissing,
    needsConsent,
    needsConfirm,
    // The form should open when anything required, consent or a confirm
    // is outstanding.
    shouldShow: required.length > 0 || needsConsent || needsConfirm,
    steps: [...show, "review"],
  };
}

module.exports = { requirementsFor, planTypeForUser };
