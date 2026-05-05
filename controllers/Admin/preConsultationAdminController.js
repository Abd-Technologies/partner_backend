const ApiResponse = require("../../helper/ApiResponse");
const { PreConsultationProfile, User } = require("../../models");

// Same whitelist as the user-side controller PLUS none — dietitians can
// edit any health/lifestyle field captured during the consultation. They
// CANNOT directly write `dietitianComments` here; comments go through the
// separate POST endpoint so each one is timestamped and author-tagged.
const ADMIN_EDITABLE_FIELDS = [
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
];

function pickEditable(body) {
  const out = {};
  for (const key of ADMIN_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }
  return out;
}

// Resolves the requester's display name for comment attribution. Falls back
// to "Staff" if the join fails so the API never breaks just because the
// User row is missing a name.
async function resolveAuthorName(userId) {
  try {
    const u = await User.findOne({
      where: { id: userId },
      attributes: ["firstName", "lastName"],
    });
    if (!u) return "Staff";
    const fn = u.firstName || "";
    const ln = u.lastName || "";
    const joined = `${fn} ${ln}`.trim();
    return joined.length ? joined : "Staff";
  } catch (_) {
    return "Staff";
  }
}

// GET /admin/pre-consultation/:userId
// Returns the full profile including dietitianComments (staff view).
exports.getProfile = async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.json(ApiResponse("0", "Invalid userId", {}));
    }
    const profile = await PreConsultationProfile.findOne({
      where: { userId: targetId },
    });
    if (!profile) {
      return res.json(ApiResponse("0", "Profile not found", {}));
    }
    return res.json(
      ApiResponse("1", "Profile fetched", { profile: profile.toJSON() })
    );
  } catch (err) {
    console.error("[preConsultation/admin] getProfile:", err);
    return res.json(ApiResponse("0", "Failed to load profile", {}));
  }
};

// PATCH /admin/pre-consultation/:userId
// Dietitian/admin edit — same whitelist as user but does NOT bump
// lastUserUpdate; instead bumps lastDietitianEdit so the user-side UI can
// show a "your dietitian updated this" hint if needed.
exports.updateProfile = async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.json(ApiResponse("0", "Invalid userId", {}));
    }
    const profile = await PreConsultationProfile.findOne({
      where: { userId: targetId },
    });
    if (!profile) {
      return res.json(ApiResponse("0", "Profile not found", {}));
    }
    const updates = pickEditable(req.body || {});
    updates.lastDietitianEdit = new Date();
    await profile.update(updates);
    return res.json(
      ApiResponse("1", "Profile updated", { profile: profile.toJSON() })
    );
  } catch (err) {
    console.error("[preConsultation/admin] updateProfile:", err);
    return res.json(ApiResponse("0", "Failed to update profile", {}));
  }
};

// POST /admin/pre-consultation/:userId/comments
// Body: { text: "..." }
// Append-only: each comment gets stamped with author and timestamp. Old
// comments are never edited or deleted via this endpoint.
exports.addComment = async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.json(ApiResponse("0", "Invalid userId", {}));
    }
    const text = req.body && req.body.text;
    if (typeof text !== "string" || !text.trim()) {
      return res.json(ApiResponse("0", "Comment text required", {}));
    }
    const profile = await PreConsultationProfile.findOne({
      where: { userId: targetId },
    });
    if (!profile) {
      return res.json(ApiResponse("0", "Profile not found", {}));
    }

    const authorId = req.user && req.user.id;
    const authorName = await resolveAuthorName(authorId);
    const newComment = {
      authorId,
      authorName,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    const existing = Array.isArray(profile.dietitianComments)
      ? profile.dietitianComments
      : [];
    const updated = [...existing, newComment];

    await profile.update({
      dietitianComments: updated,
      lastDietitianEdit: new Date(),
    });

    return res.json(
      ApiResponse("1", "Comment added", { comments: updated })
    );
  } catch (err) {
    console.error("[preConsultation/admin] addComment:", err);
    return res.json(ApiResponse("0", "Failed to add comment", {}));
  }
};
