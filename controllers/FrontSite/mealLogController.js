const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { MealLog } = require("../../models");

const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner"]);
const VALID_STATUSES = new Set([
  "pending",
  "followed",
  "alternative",
  "skipped",
]);

// Reason-code whitelists per status. Section 6.3 in the architecture doc.
const ALTERNATIVE_REASONS = new Set([
  "traveling",
  "no_ingredients",
  "didnt_like_plan",
  "hungry",
  "family_meal",
  "other",
]);
const SKIPPED_REASONS = new Set([
  "not_hungry",
  "forgot",
  "busy",
  "felt_unwell",
  "other",
]);

const EDIT_WINDOW_DAYS = 7;

function todayDateOnly() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(dateOnlyStr) {
  const target = new Date(`${dateOnlyStr}T00:00:00`);
  const today = new Date(todayDateOnly() + "T00:00:00");
  return Math.floor((today.getTime() - target.getTime()) / 86400000);
}

function rowToWire(row) {
  const json = row.toJSON ? row.toJSON() : { ...row };
  json.editable = daysBetween(json.date) <= EDIT_WINDOW_DAYS;
  return json;
}

// POST /users/meal-logs
// Body: { date: "YYYY-MM-DD", mealType: "breakfast"|"lunch"|"dinner",
//         status: "followed"|"alternative"|"skipped",
//         reasonCode?: string, alternativeText?: string }
// Upsert by (userId, date, mealType). Enforces 7-day edit window
// server-side (Section 6.6) — older logs are read-only and rejected.
exports.upsertMealLog = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const body = req.body || {};
    const date = body.date;
    const mealType = body.mealType;
    const status = body.status;

    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.json(ApiResponse("0", "Invalid date (YYYY-MM-DD)", {}));
    }
    if (!VALID_MEAL_TYPES.has(mealType)) {
      return res.json(ApiResponse("0", "Invalid mealType", {}));
    }
    if (!VALID_STATUSES.has(status)) {
      return res.json(ApiResponse("0", "Invalid status", {}));
    }

    const ageDays = daysBetween(date);
    if (ageDays < 0) {
      return res.json(ApiResponse("0", "Cannot log future meals", {}));
    }
    if (ageDays > EDIT_WINDOW_DAYS) {
      return res.json(
        ApiResponse("0", `Logs older than ${EDIT_WINDOW_DAYS} days are read-only`, {})
      );
    }

    // Reason-code validation per status.
    const reasonCode = body.reasonCode;
    if (status === "alternative") {
      if (!ALTERNATIVE_REASONS.has(reasonCode)) {
        return res.json(
          ApiResponse("0", "Invalid reasonCode for alternative meal", {})
        );
      }
    } else if (status === "skipped") {
      if (!SKIPPED_REASONS.has(reasonCode)) {
        return res.json(
          ApiResponse("0", "Invalid reasonCode for skipped meal", {})
        );
      }
    }

    const alternativeText =
      typeof body.alternativeText === "string"
        ? body.alternativeText.slice(0, 255)
        : null;

    const [row, created] = await MealLog.findOrCreate({
      where: { userId, date, mealType },
      defaults: {
        userId,
        date,
        mealType,
        status,
        reasonCode: reasonCode || null,
        alternativeText,
        firstLoggedAt: new Date(),
        editCount: 0,
      },
    });

    if (!created) {
      await row.update({
        status,
        reasonCode: reasonCode || null,
        alternativeText,
        editCount: (row.editCount || 0) + 1,
      });
    }

    return res.json(
      ApiResponse("1", "Meal log saved", { mealLog: rowToWire(row) })
    );
  } catch (err) {
    console.error("[mealLog] upsertMealLog:", err);
    return res.json(ApiResponse("0", "Failed to save meal log", {}));
  }
};

// GET /users/meal-logs?from=YYYY-MM-DD&to=YYYY-MM-DD
// Defaults to last 30 days when no params. Each row gets an `editable`
// boolean computed server-side from the 7-day edit window.
exports.listMealLogs = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const today = new Date();
    const defaultFrom = new Date(today.getTime() - 30 * 86400000);

    const fromStr =
      typeof req.query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)
        ? req.query.from
        : defaultFrom.toISOString().slice(0, 10);
    const toStr =
      typeof req.query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)
        ? req.query.to
        : todayDateOnly();

    const rows = await MealLog.findAll({
      where: {
        userId,
        date: { [Op.between]: [fromStr, toStr] },
      },
      order: [
        ["date", "DESC"],
        ["mealType", "ASC"],
      ],
    });

    return res.json(
      ApiResponse("1", "Meal logs fetched", {
        from: fromStr,
        to: toStr,
        editWindowDays: EDIT_WINDOW_DAYS,
        mealLogs: rows.map(rowToWire),
      })
    );
  } catch (err) {
    console.error("[mealLog] listMealLogs:", err);
    return res.json(ApiResponse("0", "Failed to fetch meal logs", {}));
  }
};
