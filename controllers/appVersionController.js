// App update popup — see "fitHer Flows" (App update) for the full flow.
//
//   GET  /users/app-version   (public)  → rules for both platforms
//   POST /admin/app-version   (admin)   → set latest / minimum / store link
//
// The app compares ITS version with these on every cold start:
//   older than minimum → must update (Android: Google's in-app "Immediate"
//                        update; iPhone: blocking screen → App Store)
//   older than latest  → soft popup, at most once a day (Android:
//                        Google's in-app "Flexible" download)
const { Op } = require("sequelize");
const { AppVersionConfig, User } = require("../models");
const sendNotification = require("../helper/notification");
const ApiResponse = require("../helper/ApiResponse");

const DEFAULTS = {
  android: { storeUrl: "https://play.google.com/store/apps/details?id=com.abtechnologies.fitHer" },
  ios: { storeUrl: null },
};
const VERSION_RE = /^\d+(\.\d+){0,3}$/;

function shape(platform, row) {
  return {
    latestVersion: (row && row.latestVersion) || null,
    minimumVersion: (row && row.minimumVersion) || null,
    storeUrl: (row && row.storeUrl) || DEFAULTS[platform].storeUrl,
    message: (row && row.message) || null,
  };
}

async function getAppVersion(req, res) {
  try {
    const rows = await AppVersionConfig.findAll();
    const by = Object.fromEntries(rows.map((r) => [r.platform, r]));
    return res.json(
      ApiResponse("1", "App version", { android: shape("android", by.android), ios: shape("ios", by.ios) })
    );
  } catch (e) {
    // Never block the app because of this endpoint.
    return res.json(ApiResponse("1", "App version", { android: shape("android"), ios: shape("ios") }));
  }
}

async function setAppVersion(req, res) {
  const actor = req.user && req.user.id ? await User.findByPk(req.user.id, { attributes: ["userType"] }) : null;
  const roles = require("../helper/roles");
  if (!roles.isAdmin(actor)) {
    return res.json(ApiResponse("0", roles.adminsOnlyMessage(actor), {}));
  }
  const { platform, latestVersion, minimumVersion, storeUrl, message } = req.body || {};
  if (!["android", "ios"].includes(platform)) return res.json(ApiResponse("0", "Platform must be android or ios", {}));
  const clean = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());
  const latest = clean(latestVersion);
  const minimum = clean(minimumVersion);
  for (const v of [latest, minimum]) {
    if (v && !VERSION_RE.test(v)) return res.json(ApiResponse("0", `"${v}" is not a version like 13.1.0`, {}));
  }
  if (latest && minimum && compareVersions(minimum, latest) > 0) {
    return res.json(ApiResponse("0", "Minimum version can't be higher than the latest version", {}));
  }
  const url = clean(storeUrl);
  if (url && !/^https:\/\//i.test(url)) return res.json(ApiResponse("0", "Store link must start with https://", {}));
  const [row] = await AppVersionConfig.findOrCreate({ where: { platform } });
  row.latestVersion = latest;
  row.minimumVersion = minimum;
  row.storeUrl = url;
  row.message = clean(message);
  await row.save();
  return res.json(ApiResponse("1", "Saved", shape(platform, row)));
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// ── App version report + "please update" push ────────────────────────

/** POST /users/app-version/report { platform, version } — app sends on start. */
async function reportAppVersion(req, res) {
  const { platform, version } = req.body || {};
  if (!req.user || !req.user.id) return res.json(ApiResponse("0", "Not logged in", {}));
  if (!["android", "ios"].includes(platform) || !VERSION_RE.test(String(version || ""))) {
    return res.json(ApiResponse("0", "Bad platform / version", {}));
  }
  await User.update(
    { appVersion: String(version), appPlatform: platform, appVersionAt: new Date() },
    { where: { id: req.user.id } }
  );
  // Growth analytics: one row per day she opens the app.
  require("../helper/growthTracking").activeDay(req.user.id, { platform, appVersion: String(version) });
  return res.json(ApiResponse("1", "OK", {}));
}

async function isAdmin(req) {
  const actor = req.user && req.user.id ? await User.findByPk(req.user.id, { attributes: ["userType"] }) : null;
  return require("../helper/roles").isAdmin(actor);
}

/**
 * Who should get the push: clients (not staff) with a device, whose app is
 * older than their platform's Latest — or who never reported a version
 * (old app = needs the update). required = below that platform's Minimum.
 */
async function updateAudience() {
  const rows = await AppVersionConfig.findAll();
  const rule = Object.fromEntries(rows.map((r) => [r.platform, r]));
  const users = await User.findAll({
    where: { userType: process.env.USER || "User", deviceToken: { [Op.ne]: null } },
    attributes: ["id", "deviceToken", "appVersion", "appPlatform"],
  });
  const anyMinimum = ["android", "ios"].some((p) => rule[p] && rule[p].minimumVersion);
  const out = [];
  for (const u of users) {
    if (!u.deviceToken) continue;
    if (!u.appVersion) {
      out.push({ token: u.deviceToken, required: anyMinimum });
      continue;
    }
    const r = rule[u.appPlatform];
    if (!r || !r.latestVersion) continue;
    if (compareVersions(u.appVersion, r.latestVersion) >= 0) continue;
    const required = !!(r.minimumVersion && compareVersions(u.appVersion, r.minimumVersion) < 0);
    out.push({ token: u.deviceToken, required });
  }
  return { rule, audience: out };
}

function notifyKey(rule) {
  return ["android", "ios"].map((p) => (rule[p] && rule[p].latestVersion) || "-").join("|");
}

/** GET /admin/app-version/audience — how many would get the push now. */
async function appUpdateAudience(req, res) {
  if (!(await isAdmin(req))) return res.json(ApiResponse("0", "Admins only", {}));
  const { rule, audience } = await updateAudience();
  const key = notifyKey(rule);
  const alreadySent = ["android", "ios"].every(
    (p) => !rule[p] || !rule[p].latestVersion || rule[p].notifiedVersion === rule[p].latestVersion
  );
  return res.json(
    ApiResponse("1", "Audience", {
      count: audience.length,
      required: audience.filter((a) => a.required).length,
      alreadySent: key !== "-|-" && alreadySent,
      hasLatest: key !== "-|-",
    })
  );
}

/** POST /admin/app-version/notify — sends once per Latest version. */
async function notifyAppUpdate(req, res) {
  if (!(await isAdmin(req))) return res.json(ApiResponse("0", "Admins only", {}));
  const { rule, audience } = await updateAudience();
  if (notifyKey(rule) === "-|-") return res.json(ApiResponse("0", "Set a Latest version first.", {}));
  const pending = ["android", "ios"].filter(
    (p) => rule[p] && rule[p].latestVersion && rule[p].notifiedVersion !== rule[p].latestVersion
  );
  if (!pending.length) return res.json(ApiResponse("0", "Already sent for this version.", {}));
  if (!audience.length) return res.json(ApiResponse("0", "Nobody needs to update right now.", {}));

  // Mark first, so a double tap can't send twice.
  for (const p of pending) {
    rule[p].notifiedVersion = rule[p].latestVersion;
    rule[p].notifiedAt = new Date();
    await rule[p].save();
  }

  const groups = [
    {
      tokens: audience.filter((a) => a.required).map((a) => a.token),
      msg: { title: "Please update Fit Her", body: "Update to the new version to keep joining your classes 💚" },
    },
    {
      tokens: audience.filter((a) => !a.required).map((a) => a.token),
      msg: { title: "A new version of Fit Her is here ✨", body: "Update from the store to get the latest improvements." },
    },
  ];
  let sent = 0;
  for (const g of groups) {
    const tokens = Array.from(new Set(g.tokens));
    for (let i = 0; i < tokens.length; i += 500) {
      const r = await sendNotification(tokens.slice(i, i + 500), g.msg, { type: "appUpdate" });
      sent += (r && r.successCount) || 0;
    }
  }
  console.log(`[app-update-push] audience ${audience.length}, delivered ${sent}`);
  return res.json(ApiResponse("1", `Sent to ${sent} user(s)`, { audience: audience.length, delivered: sent }));
}

module.exports = {
  getAppVersion,
  setAppVersion,
  compareVersions,
  reportAppVersion,
  appUpdateAudience,
  notifyAppUpdate,
};
