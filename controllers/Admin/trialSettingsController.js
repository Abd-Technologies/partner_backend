// Admin: free trial length (Oct 2026). See helper/trialDaysSetting.js.
const { User } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const { isAdmin, adminsOnlyMessage } = require("../../helper/roles");
const setting = require("../../helper/trialDaysSetting");
const { getTrialDays, envTrialDays } = require("../../helper/trialState");

async function me(req) {
  if (!req.user || !req.user.id) return null;
  return User.findByPk(req.user.id, { attributes: ["id", "userType"] });
}

function payload() {
  return {
    trialDays: getTrialDays(),
    // "admin" = set here; "default" = .env TRIAL_DAYS (or 3)
    source: setting.adminTrialDays() == null ? "default" : "admin",
    defaultDays: envTrialDays(),
    min: setting.MIN_DAYS,
    max: setting.MAX_DAYS,
  };
}

/** GET /admin/trialDays — current trial length. Admin only. */
async function getTrialDaysSetting(req, res) {
  const actor = await me(req);
  if (!isAdmin(actor)) return res.json(ApiResponse("0", adminsOnlyMessage(actor), {}));
  await setting.load();
  return res.json(ApiResponse("1", "Trial length", payload()));
}

/** POST /admin/trialDays { trialDays } — 1..14. Admin only. */
async function setTrialDaysSetting(req, res) {
  const actor = await me(req);
  if (!isAdmin(actor)) return res.json(ApiResponse("0", adminsOnlyMessage(actor), {}));
  const raw = (req.body || {}).trialDays;
  const n = parseInt(raw, 10);
  if (!Number.isInteger(n) || n < setting.MIN_DAYS || n > setting.MAX_DAYS) {
    return res.json(
      ApiResponse("0", `Trial length must be ${setting.MIN_DAYS} to ${setting.MAX_DAYS} days.`, {})
    );
  }
  await setting.setTrialDays(n, actor.id);
  console.log(`[trial-days] set to ${n} by admin ${actor.id}`);
  return res.json(ApiResponse("1", "Trial length saved", payload()));
}

module.exports = { getTrialDaysSetting, setTrialDaysSetting };
