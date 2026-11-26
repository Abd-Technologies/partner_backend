// Health (Nov 2026).
//   GET /health        public, minimal — uptime monitors / load balancer
//   GET /admin/health  admin — database, every scheduled job, recent errors,
//                      the CRM event outbox, and users still on old tokens.
const express = require("express");
const ApiResponse = require("../helper/ApiResponse");
const { validateToken } = require("../middlewares/AuthorizationMW");
const { requireAdmin } = require("../middlewares/roleGuards");
const asyncMiddleware = require("../middlewares/async");

const router = express.Router();
const db = () => require("../models").sequelize;
const minutesAgo = (d) => (d ? Math.round((Date.now() - new Date(d).getTime()) / 60000) : null);

router.get("/health", async (req, res) => {
  let ok = false;
  try { await db().query("SELECT 1"); ok = true; } catch (_) {}
  res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", db: ok, role: process.env.RUN_JOBS || "all", uptime_s: Math.round(process.uptime()) });
});

router.get("/admin/health", validateToken, requireAdmin, asyncMiddleware(async (req, res) => {
  const out = { checked_at: new Date().toISOString(), problems: [], warnings: [] };
  const sequelize = db();

  const t0 = Date.now();
  try { await sequelize.query("SELECT 1"); out.db = { ok: true, ms: Date.now() - t0 }; }
  catch (e) { out.db = { ok: false, error: e.message }; out.problems.push("Database unreachable"); }

  try {
    const rows = await require("../helper/jobRunner").status(sequelize);
    out.jobs = rows.map((r) => {
      const failedRecently = r.last_error_at && (!r.last_ok || new Date(r.last_error_at) > new Date(r.last_ok));
      const silent = minutesAgo(r.updated_at) > 15;
      if (failedRecently) out.warnings.push(`Job ${r.name} failed: ${r.last_error}`);
      if (silent) out.warnings.push(`Job ${r.name} (${r.role}@${r.host}) has not reported for ${minutesAgo(r.updated_at)} min`);
      return { ...r, last_ok_min_ago: minutesAgo(r.last_ok), failed_recently: !!failedRecently, silent };
    });
  } catch (e) { out.jobs = { error: e.message }; }

  try { out.errors_24h = await require("../helper/errorMonitor").recent(sequelize, 24, 15); }
  catch (e) { out.errors_24h = { error: e.message }; }

  try {
    const { CrmOutbox } = require("../models");
    const [counts] = await sequelize.query(`SELECT status, COUNT(*) AS n, MIN(createdAt) AS oldest FROM ${CrmOutbox.getTableName()} GROUP BY status`);
    out.crm_outbox = Object.fromEntries(counts.map((c) => [c.status, { count: Number(c.n), oldest_min_ago: minutesAgo(c.oldest) }]));
    if (out.crm_outbox.dead) out.warnings.push(`${out.crm_outbox.dead.count} CRM event(s) dead (the CRM rejected them)`);
    const pending = out.crm_outbox.pending || out.crm_outbox.queued;
    if (pending && pending.oldest_min_ago > 30) out.warnings.push(`CRM events waiting ${pending.oldest_min_ago} min (CRM down?)`);
  } catch (e) { out.crm_outbox = { error: e.message }; }

  try {
    const legacy = await require("../helper/legacyTokens").list();
    out.legacy_tokens = { users: legacy.count, days_left: legacy.daysLeft, cutoff: legacy.cutoff };
    if (legacy.count) out.warnings.push(`${legacy.count} user(s) still on old login tokens — ${legacy.daysLeft} day(s) left (GET /admin/legacy-tokens)`);
  } catch (e) { out.legacy_tokens = { error: e.message }; }

  out.status = out.problems.length ? "problem" : out.warnings.length ? "warning" : "ok";
  res.json(ApiResponse("1", out.status, out));
}));

module.exports = router;
