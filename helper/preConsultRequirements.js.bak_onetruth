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
const { PreConsultationProfile, User, UserCycleData } = require("../models");

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
    User.findByPk(userId, { attributes: ["id", "mainGoal", "healthConditions"] }),
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
  if (blank(user && user.healthConditions)) required.push("conditions");
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
    needsConsent,
    needsConfirm,
    // The form should open when anything required, consent or a confirm
    // is outstanding.
    shouldShow: required.length > 0 || needsConsent || needsConfirm,
    steps: [...show, "review"],
  };
}

module.exports = { requirementsFor };
