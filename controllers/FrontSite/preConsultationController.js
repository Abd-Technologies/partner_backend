const ApiResponse = require("../../helper/ApiResponse");
const { PreConsultationProfile, User } = require("../../models");
const { requirementsFor } = require("../../helper/preConsultRequirements");

// Fields the user is allowed to set/update on their own profile. Anything
// else in the request body is silently ignored (whitelist, not blacklist —
// safer if new admin-only fields are added later).
// Bump when the consent wording in the app changes, so we always know
// which text each woman agreed to.
const HEALTH_CONSENT_VERSION = "v1";

const USER_EDITABLE_FIELDS = [
  "goals",
  "allergies",
  "pregnancyMenstrualStatus",
  "dietaryPreferences",
  "medicalConditions",
  "familyHistory",
  "lifestyle",
  "fastingHabits",
  "surgeries",
  "currentMedications",
  "workoutSection",
  "mealsPerDay",
];

function pickEditable(body) {
  const out = {};
  for (const key of USER_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }
  return out;
}

// MariaDB (XAMPP) returns DataTypes.JSON columns as raw JSON *strings*
// instead of objects (see the note in models/PendingPopupState.js). The
// app then tried to read e.g. dietaryPreferences as a list, crashed while
// parsing, and the dietitian's "Health form & notes" screen never opened.
// Parse them here so the wire format is always real JSON.
const PROFILE_JSON_FIELDS = [
  "dietaryPreferences",
  "lifestyle",
  "workoutSection",
  "dietitianComments",
  "stepsCompleted",
];
function parseProfileJson(json) {
  for (const key of PROFILE_JSON_FIELDS) {
    const v = json[key];
    if (typeof v === "string" && v.trim()) {
      try {
        json[key] = JSON.parse(v);
      } catch (_) {
        // leave as-is if it isn't valid JSON
      }
    }
  }
  return json;
}

function toWire(row) {
  // Strip dietitianComments from user-facing payload — those are private
  // notes only readable by staff.
  const json = parseProfileJson(row.toJSON ? row.toJSON() : { ...row });
  delete json.dietitianComments;
  return json;
}

// GET /users/pre-consultation
// Returns the current user's profile. Creates an empty draft row on first
// call so the multi-step form has a stable target for PATCH auto-saves.
exports.getOwnProfile = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.json(ApiResponse("0", "Unauthorized", {}));
    }
    let profile = await PreConsultationProfile.findOne({ where: { userId } });
    if (!profile) {
      profile = await PreConsultationProfile.create({
        userId,
        stepsCompleted: {},
        dietitianComments: [],
        isComplete: false,
      });
    }
    return res.json(
      ApiResponse("1", "Profile fetched", { profile: toWire(profile) })
    );
  } catch (err) {
    console.error("[preConsultation] getOwnProfile:", err);
    return res.json(ApiResponse("0", "Failed to load profile", {}));
  }
};

// PATCH /users/pre-consultation
// Partial update — auto-save per step (Decision 5 locked at one PATCH per
// step). Body shape:
//   {
//     // any subset of USER_EDITABLE_FIELDS
//     goals: "weight_loss",
//     allergies: "peanuts",
//     // step ack — merged into the existing stepsCompleted JSON
//     step: "goals",
//     // optional: send true on the final step's PATCH to mark complete
//     isComplete: true
//   }
// MariaDB hands JSON columns back as strings. Spreading that string
// ({...'{"a":true}'}) turned every character into its own key, and each
// save doubled the size until MySQL refused the packet. Always parse,
// and drop any junk character keys left from that bug.
function cleanSteps(raw) {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch (_) {
      return {};
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (!/^\d+$/.test(k) && val === true) out[k] = true;
  }
  return out;
}

exports.updateOwnProfile = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.json(ApiResponse("0", "Unauthorized", {}));
    }

    let profile = await PreConsultationProfile.findOne({ where: { userId } });
    if (!profile) {
      profile = await PreConsultationProfile.create({
        userId,
        stepsCompleted: {},
        dietitianComments: [],
        isComplete: false,
      });
    }

    const updates = pickEditable(req.body || {});

    // Merge the step ack into existing stepsCompleted JSON. Sequelize's
    // JSON-column equality check needs a fresh object reference, hence the
    // spread instead of mutating in place.
    const stepKey = req.body && req.body.step;
    if (typeof stepKey === "string" && stepKey.length > 0) {
      updates.stepsCompleted = { ...cleanSteps(profile.stepsCompleted), [stepKey]: true };
    }

    if (req.body && req.body.isComplete === true) {
      updates.isComplete = true;
    }

    // Only 3 to 6 meals are supported by the AI meal templates.
    if (
      Object.prototype.hasOwnProperty.call(updates, "mealsPerDay") &&
      ![3, 4, 5, 6].includes(Number(updates.mealsPerDay))
    ) {
      delete updates.mealsPerDay;
    }

    // Health data consent from the review screen. The server stamps the
    // time; the app sends which wording version she agreed to.
    if (req.body && req.body.healthConsent === true) {
      updates.healthConsentAt = new Date();
      updates.healthConsentVersion = String(
        req.body.consentVersion || HEALTH_CONSENT_VERSION
      ).slice(0, 16);
    }

    // A paid user reviewed the answers she gave during her free trial
    // (or re-submitted the form) and confirmed they're correct. From now
    // on the profile counts as her real pre-consultation form.
    if (req.body && req.body.confirmed === true) {
      updates.intakeSource = "user_confirmed";
      updates.isComplete = true;
    }

    updates.lastUserUpdate = new Date();

    await profile.update(updates);

    // Signup answers asked again in the pre-consultation form for users
    // who signed up before those questions existed. They live on the
    // User row, so the whole app keeps reading them from one place.
    const userUpdates = {};
    if (req.body && typeof req.body.userMainGoal === "string" && req.body.userMainGoal.trim()) {
      userUpdates.mainGoal = req.body.userMainGoal.trim().slice(0, 64);
    }
    if (req.body && typeof req.body.userHealthConditions === "string") {
      userUpdates.healthConditions = req.body.userHealthConditions.trim().slice(0, 255) || "none";
    }
    if (Object.keys(userUpdates).length) {
      await User.update(userUpdates, { where: { id: userId } });
    }

    return res.json(
      ApiResponse("1", "Profile updated", { profile: toWire(profile) })
    );
  } catch (err) {
    console.error("[preConsultation] updateOwnProfile:", err);
    return res.json(ApiResponse("0", "Failed to update profile", {}));
  }
};

// GET /users/pre-consultation/requirements?planType=diet|workout|combined
// Which steps of the pre-consultation form she still has to answer.
exports.getRequirements = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));
    // Her package decides the questions (one truth). The app's planType
    // is only a fallback for women with no paid package (e.g. trial).
    const { planTypeForUser } = require("../../helper/preConsultRequirements");
    const t = String(req.query.planType || "diet");
    const planType =
      (await planTypeForUser(userId)) ||
      (["diet", "workout", "combined"].includes(t) ? t : "diet");
    const data = await requirementsFor(userId, planType);
    return res.json(ApiResponse("1", "Requirements", data));
  } catch (err) {
    console.error("[preConsultation] getRequirements:", err);
    return res.json(ApiResponse("0", "Could not load", {}));
  }
};

// ── Life stage (signup step 5) ──────────────────────────────────────────
// GET  /users/pre-consultation/life-stage
// POST /users/pre-consultation/life-stage
//   { status?, babyBirthDate?: 'YYYY-MM-DD', deliveryType?: 'normal'|'c_section',
//     doctorCleared?: true }
// Both return { status, access, availableFrom, babyBirthDate, deliveryType, waitDays }.
// access: full | pregnant | needs_details | waiting | needs_clearance
const lifeStage = require("../../helper/lifeStage");

exports.getLifeStage = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));
    const data = await lifeStage.getLifeStage(userId);
    return res.json(ApiResponse("1", "Life stage", data));
  } catch (err) {
    console.error("[preConsultation] getLifeStage:", err);
    return res.json(ApiResponse("0", "Could not load", {}));
  }
};

exports.saveLifeStage = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));
    const data = await lifeStage.saveLifeStage(userId, req.body || {});
    return res.json(ApiResponse("1", "Saved", data));
  } catch (err) {
    if (err.userMessage) return res.json(ApiResponse("0", err.userMessage, {}));
    console.error("[preConsultation] saveLifeStage:", err);
    return res.json(ApiResponse("0", "Could not save. Please try again.", {}));
  }
};
