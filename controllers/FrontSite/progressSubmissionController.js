const ApiResponse = require("../../helper/ApiResponse");
const {
  ProgressSubmission,
  PendingPopupState,
  UserPlan,
  User,
} = require("../../models");

const VALID_CYCLES = new Set([15, 30]);
const VALID_CLOTHES_FIT = new Set(["tighter", "same", "looser"]);

function pickFields(body) {
  const fields = [
    "weightKg",
    "waistCm",
    "hipsCm",
    "chestCm",
    "armsCm",
    "thighsCm",
    "clothesFit",
    "sleepQuality",
    "satisfaction",
    "strengthNotes",
  ];
  const out = {};
  for (const k of fields) {
    if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  }
  return out;
}

// POST /users/progress
// Body: { userPlanId, cycle: 15|30, weightKg, waistCm, hipsCm, chestCm,
//         armsCm, thighsCm, clothesFit, sleepQuality, satisfaction,
//         strengthNotes }
// Idempotent on (userPlanId, cycle): overwrites the previous submission
// if user re-opens the popup. Photos never touch this endpoint —
// device-only per Section 10.
exports.submit = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const body = req.body || {};
    const userPlanId = parseInt(body.userPlanId, 10);
    const cycle = parseInt(body.cycle, 10);

    if (!Number.isInteger(userPlanId) || userPlanId <= 0) {
      return res.json(ApiResponse("0", "Invalid userPlanId", {}));
    }
    if (!VALID_CYCLES.has(cycle)) {
      return res.json(ApiResponse("0", "cycle must be 15 or 30", {}));
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "clothesFit") &&
      body.clothesFit != null &&
      !VALID_CLOTHES_FIT.has(body.clothesFit)
    ) {
      return res.json(ApiResponse("0", "Invalid clothesFit", {}));
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "sleepQuality") &&
      body.sleepQuality != null &&
      !(Number(body.sleepQuality) >= 1 && Number(body.sleepQuality) <= 5)
    ) {
      return res.json(ApiResponse("0", "sleepQuality must be 1-5", {}));
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "satisfaction") &&
      body.satisfaction != null &&
      !(Number(body.satisfaction) >= 1 && Number(body.satisfaction) <= 5)
    ) {
      return res.json(ApiResponse("0", "satisfaction must be 1-5", {}));
    }

    const plan = await UserPlan.findOne({ where: { id: userPlanId, userId } });
    if (!plan) return res.json(ApiResponse("0", "Plan not found", {}));

    const fields = pickFields(body);
    fields.userId = userId;
    fields.userPlanId = userPlanId;
    fields.cycle = cycle;
    fields.submittedAt = new Date();

    const [row, created] = await ProgressSubmission.findOrCreate({
      where: { userPlanId, cycle },
      defaults: fields,
    });
    if (!created) {
      await row.update(fields);
    }

    // Retire the matching popup state (POPUP_DAY15_PROGRESS or _DAY30_).
    try {
      const variable =
        cycle === 15 ? "POPUP_DAY15_PROGRESS" : "POPUP_DAY30_PROGRESS";
      const existing = await PendingPopupState.findOne({
        where: { userId, popupVariable: variable, completedAt: null },
        order: [["createdAt", "DESC"]],
      });
      if (existing) {
        await existing.update({ completedAt: new Date() });
      } else {
        await PendingPopupState.create({
          userId,
          popupVariable: variable,
          completedAt: new Date(),
          metadata: { progressSubmissionId: row.id, cycle },
        });
      }
    } catch (e) {
      console.error("[progress] popup state update failed:", e);
    }

    return res.json(
      ApiResponse("1", "Progress submitted", { progress: row.toJSON() })
    );
  } catch (err) {
    console.error("[progress] submit:", err);
    return res.json(ApiResponse("0", "Failed to submit progress", {}));
  }
};

// GET /users/progress/previous?userPlanId=&cycle=15|30
// Section 9: "previous values pre-filled for comparison". Day 15 is the
// user's FIRST checkpoint on this plan — there's no earlier
// ProgressSubmission to compare against, so cycle=15 always returns
// { previous: null } (this is expected, not an error; the client just
// shows blank fields with no "Last: ..." ghost text). Day 30's previous
// values are the same plan's cycle:15 row.
exports.getPrevious = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const userPlanId = parseInt(req.query.userPlanId, 10);
    const cycle = parseInt(req.query.cycle, 10);
    if (!Number.isInteger(userPlanId) || userPlanId <= 0) {
      return res.json(ApiResponse("0", "Invalid userPlanId", {}));
    }
    if (!VALID_CYCLES.has(cycle)) {
      return res.json(ApiResponse("0", "cycle must be 15 or 30", {}));
    }

    const plan = await UserPlan.findOne({ where: { id: userPlanId, userId } });
    if (!plan) return res.json(ApiResponse("0", "Plan not found", {}));

    if (cycle === 15) {
      // No earlier checkpoint exists on this plan yet.
      return res.json(ApiResponse("1", "No previous checkpoint", { previous: null }));
    }

    const prior = await ProgressSubmission.findOne({
      where: { userPlanId, cycle: 15 },
    });

    return res.json(
      ApiResponse("1", "Previous progress fetched", {
        previous: prior ? prior.toJSON() : null,
      })
    );
  } catch (err) {
    console.error("[progress] getPrevious:", err);
    return res.json(ApiResponse("0", "Failed to fetch previous progress", {}));
  }
};

// GET /admin/users/:userId/progress
// Lists a user's progress submissions ordered most-recent first. Used by
// the dietitian dashboard during the Day 15 / Day 30 follow-up.
exports.listForUser = async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.json(ApiResponse("0", "Invalid userId", {}));
    }
    const rows = await ProgressSubmission.findAll({
      where: { userId: targetId },
      order: [["submittedAt", "DESC"]],
    });
    return res.json(
      ApiResponse("1", "Progress list fetched", {
        progressSubmissions: rows.map((r) => r.toJSON()),
      })
    );
  } catch (err) {
    console.error("[progress/admin] listForUser:", err);
    return res.json(ApiResponse("0", "Failed to fetch progress", {}));
  }
};
