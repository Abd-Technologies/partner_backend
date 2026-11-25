/**
 * errorMonitor.js — error monitoring without a third-party service (same as the CRM).
 *
 * Almost every failure in this codebase is caught and logged with
 * console.error, so nobody hears about it. This records every console.error
 * (grouped by message, with numbers and ids normalised away) into
 * `system_errors` once a minute, and — if ALERT_WEBHOOK_URL is set — posts an
 * alert the first time a new kind of error appears, or when one spikes.
 * Works with Slack, Google Chat and Discord incoming webhooks.
 *
 *   install({ sequelize, role })   once, at process start
 *   recent(sequelize, hours)       top errors for the health page
 */
const crypto = require("crypto");
const os = require("os");
const util = require("util");
const { ensureTables } = require("./monitorTables");

const SPIKE = Number(process.env.ALERT_ERROR_SPIKE || 50);       // per minute
const ALERT_EVERY_MS = 60 * 60 * 1000;                           // per signature
const buf = new Map();     // hash -> { signature, sample, count }
const alerted = new Map(); // hash -> last alert ms
let origError = console.error.bind(console);
let installed = false;

function signature(firstLine) {
  return String(firstLine)
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")   // ids, hashes
    .replace(/\d+/g, "#")                 // numbers, dates, lead ids
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 250);
}

function record(args) {
  const text = args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : util.inspect(a, { depth: 2 })))
    .join(" ");
  const first = text.split("\n").find((l) => l.trim()) || "(empty)";
  const sig = signature(first);
  const hash = crypto.createHash("sha1").update(sig).digest("hex");
  const e = buf.get(hash) || { signature: sig, sample: "", count: 0 };
  e.count += 1;
  e.sample = text.slice(0, 2000);
  buf.set(hash, e);
}

async function alert(role, kind, e) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const text = `[Fit Her app backend · ${role} · ${os.hostname()}] ${kind}: ${e.signature}\n${e.sample.slice(0, 600)}`;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text.slice(0, 1900) }) });
  } catch (err) {
    origError("[monitor] alert failed:", err.message);
  }
}

async function flush(sequelize, role) {
  if (!buf.size) return;
  const batch = [...buf.entries()];
  buf.clear();
  try {
    await ensureTables(sequelize);
    for (const [hash, e] of batch) {
      const [, meta] = await sequelize.query(
        `INSERT INTO system_errors (sig_hash, signature, sample, process, count, first_seen, last_seen)
         VALUES (:hash, :sig, :sample, :role, :count, NOW(), NOW())
         ON DUPLICATE KEY UPDATE count = count + VALUES(count), sample = VALUES(sample),
                                 process = VALUES(process), last_seen = NOW()`,
        { replacements: { hash, sig: e.signature, sample: e.sample, role, count: e.count } }
      );
      // affectedRows: 1 = new row (never seen before), 2 = existing row updated.
      const isNew = meta && (meta.affectedRows === 1 || meta === 1);
      const last = alerted.get(hash) || 0;
      if ((isNew || e.count >= SPIKE) && Date.now() - last > ALERT_EVERY_MS) {
        alerted.set(hash, Date.now());
        await alert(role, isNew ? "New error" : `${e.count} errors in a minute`, e);
      }
    }
  } catch (err) {
    origError("[monitor] could not save errors:", err.message);
    // Put them back so the next flush retries (bounded).
    if (buf.size < 500) for (const [h, e] of batch) if (!buf.has(h)) buf.set(h, e);
  }
}

function install({ sequelize, role = process.env.RUN_JOBS || "all" } = {}) {
  if (installed) return;
  installed = true;
  origError = console.error.bind(console);
  console.error = (...args) => {
    origError(...args);
    try { record(args); } catch (_) { /* never break logging */ }
  };
  // Observe crashes without changing Node's crash behaviour (PM2 restarts).
  process.on("uncaughtExceptionMonitor", (err) => {
    try { record(["[crash]", err]); } catch (_) {}
  });
  setInterval(() => flush(sequelize, role), 60 * 1000).unref();
}

async function recent(sequelize, hours = 24, limit = 15) {
  await ensureTables(sequelize);
  const [rows] = await sequelize.query(
    `SELECT signature, sample, process, count, first_seen, last_seen
       FROM system_errors WHERE last_seen >= DATE_SUB(NOW(), INTERVAL :h HOUR)
      ORDER BY last_seen DESC LIMIT :limit`,
    { replacements: { h: hours, limit } }
  );
  return rows;
}

module.exports = { install, recent, flush, signature, _buf: buf };
