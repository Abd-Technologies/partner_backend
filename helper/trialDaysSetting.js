// Free trial length set by the admin (Oct 2026).
//
// Stored in AppSettings (key "trialDays"). Read is sync and cached so
// getTrialDays() in helper/trialState.js stays sync for every caller;
// the cache is refreshed at start-up, every minute, and on save.
// No admin value saved yet → TRIAL_DAYS from .env → 3.
const KEY = "trialDays";
const MIN_DAYS = 1;
const MAX_DAYS = 14; // the AI trial meal plan supports up to 14 days

let cached = null;
let loaded = false;

function models() {
  return require("../models");
}

function clampDays(v) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n)) return null;
  return Math.min(Math.max(n, MIN_DAYS), MAX_DAYS);
}

async function load() {
  try {
    const { AppSetting } = models();
    if (!AppSetting) return cached;
    const row = await AppSetting.findOne({ where: { key: KEY } });
    cached = row ? clampDays(row.value) : null;
    loaded = true;
  } catch (_) {
    /* table not ready yet: keep the last value */
  }
  return cached;
}

/** Admin value, or null when none is saved. Sync (cached). */
function adminTrialDays() {
  if (!loaded) load();
  return cached;
}

async function setTrialDays(days, adminId) {
  const value = clampDays(days);
  if (value == null) throw new Error("trialDays must be a whole number");
  const { AppSetting } = models();
  const [row] = await AppSetting.findOrCreate({
    where: { key: KEY },
    defaults: { value: String(value), updatedBy: adminId },
  });
  row.value = String(value);
  row.updatedBy = adminId;
  await row.save();
  cached = value;
  loaded = true;
  return value;
}

const timer = setInterval(load, 60 * 1000);
if (timer.unref) timer.unref();

module.exports = { load, adminTrialDays, setTrialDays, clampDays, MIN_DAYS, MAX_DAYS };
