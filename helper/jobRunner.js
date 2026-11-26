// jobRunner.js — every scheduled job (jobs/scheduler.js) runs through here
// (Nov 2026, same design as the CRM's src/monitor/jobs.js):
//   • a database lease lock: a job runs in ONE process at a time, so the
//     app can run more than one instance without double pushes/reminders;
//   • no overlap inside a process;
//   • a heartbeat per job (last start / success / error / duration),
//     saved to job_heartbeats every minute, for GET /admin/health;
//   • failures logged once, with the job's name.
//
//   lockedCron(nodeCron, mode)  drop-in for node-cron whose schedule() wraps
//                               every job; mode decides what runs HERE:
//       all    (default) every job
//       web    only jobs that push live socket updates (they need the
//              socket server, so they run in the web process)
//       worker every other job (run by worker.js)
//       none   nothing
//   wrap(name, fn, opts)        the wrapper itself
//   status(sequelize)           rows for the health page
const os = require("os");
const { ensureTables } = require("./monitorTables");

const HOST = os.hostname().slice(0, 80);
const OWNER = `${HOST}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
const state = new Map();
let role = "all";
const db = () => require("../models").sequelize;

async function acquire(name, ttlSec) {
  const sequelize = db();
  await ensureTables(sequelize);
  // MySQL/MariaDB apply these left to right: take the lock if it expired (or
  // is ours), then extend it only if we now own it.
  await sequelize.query(
    `INSERT INTO job_locks (name, owner, locked_until)
     VALUES (:name, :owner, DATE_ADD(NOW(), INTERVAL :ttl SECOND))
     ON DUPLICATE KEY UPDATE
       owner        = IF(locked_until < NOW() OR owner = VALUES(owner), VALUES(owner), owner),
       locked_until = IF(owner = VALUES(owner), VALUES(locked_until), locked_until)`,
    { replacements: { name, owner: OWNER, ttl: ttlSec } }
  );
  const [[row]] = await sequelize.query("SELECT owner FROM job_locks WHERE name = :name", { replacements: { name } });
  return !!row && row.owner === OWNER;
}
async function release(name) {
  await db().query("UPDATE job_locks SET locked_until = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE name = :name AND owner = :owner",
    { replacements: { name, owner: OWNER } });
}

function wrap(name, fn, { ttlSec = 600, lock = true } = {}) {
  if (!state.has(name)) state.set(name, { name, running: false, runs: 0, fails: 0, skips: 0, lastStart: null, lastOk: null, lastError: null, lastErrorAt: null, lastMs: null, dirty: false });
  startFlusher();
  return async function wrappedJob(...args) {
    const st = state.get(name);
    if (st.running) { st.skips++; st.dirty = true; return undefined; }
    st.running = true;
    let locked = false;
    try {
      if (lock) {
        try { locked = await acquire(name, ttlSec); }
        catch (e) { console.error(`[job ${name}] lock check failed, skipping this run:`, e.message); st.skips++; st.dirty = true; return undefined; }
        if (!locked) { st.skips++; st.dirty = true; return undefined; }
      }
      const t0 = Date.now();
      st.lastStart = new Date();
      try {
        const out = await fn(...args);
        st.runs++; st.lastOk = new Date();
        return out;
      } catch (e) {
        st.fails++; st.lastError = String((e && e.message) || e).slice(0, 500); st.lastErrorAt = new Date();
        console.error(`[job ${name}] failed:`, e);
        return undefined;
      } finally { st.lastMs = Date.now() - t0; st.dirty = true; }
    } finally {
      st.running = false;
      if (locked) release(name).catch(() => {});
    }
  };
}

const usesSocket = (fn) => /autoCancelLateClasses|getIO\s*\(/.test(String(fn));
function nameFor(fn, expr, used) {
  const src = String(fn);
  const m = src.match(/\[cron\]\s*([\w:.\-]+)/) || src.match(/\[([\w.\-]+)\]/) || src.match(/await\s+([A-Za-z_$][\w$.]*)\s*\(/) || (fn.name && [null, fn.name]);
  let name = (m && m[1] ? m[1] : `cron ${expr}`).replace(/[^\w:.\- ]/g, "").slice(0, 70);
  let n = name, i = 2;
  while (used.has(n)) n = `${name}#${i++}`;
  used.add(n);
  return n;
}

function lockedCron(nodeCron, mode = "all") {
  role = String(mode || "all").slice(0, 20);
  const used = new Set();
  const runsHere = (fn) =>
    role === "all" ? true : role === "none" ? false : role === "web" ? usesSocket(fn) : !usesSocket(fn);
  return {
    ...nodeCron,
    // true when this process runs the non-socket jobs (one-off boot tasks follow it)
    runsNonSocket: role === "all" || role === "worker",
    schedule(expr, fn, opts) {
      const name = nameFor(fn, expr, used);
      if (!runsHere(fn)) return null;
      return nodeCron.schedule(expr, wrap(name, fn), opts);
    },
  };
}

async function flushHeartbeats() {
  try {
    const sequelize = db();
    await ensureTables(sequelize);
    for (const st of state.values()) {
      if (!st.dirty) continue;
      st.dirty = false;
      await sequelize.query(
        `INSERT INTO job_heartbeats (name, host, role, last_start, last_ok, last_error, last_error_at, last_ms, runs, fails, skips, updated_at)
         VALUES (:name, :host, :role, :ls, :lo, :le, :lea, :ms, :runs, :fails, :skips, NOW())
         ON DUPLICATE KEY UPDATE last_start = VALUES(last_start), last_ok = VALUES(last_ok),
           last_error = VALUES(last_error), last_error_at = VALUES(last_error_at), last_ms = VALUES(last_ms),
           runs = VALUES(runs), fails = VALUES(fails), skips = VALUES(skips), updated_at = NOW()`,
        { replacements: { name: st.name, host: HOST, role, ls: st.lastStart, lo: st.lastOk, le: st.lastError, lea: st.lastErrorAt, ms: st.lastMs, runs: st.runs, fails: st.fails, skips: st.skips } }
      );
    }
  } catch (e) {
    console.error("[jobs] heartbeat save failed:", e.message);
  }
}
let flusher = null;
function startFlusher() {
  if (flusher) return;
  flusher = setInterval(flushHeartbeats, 60 * 1000);
  flusher.unref();
}

async function status(sequelize) {
  await ensureTables(sequelize);
  const [rows] = await sequelize.query(
    `SELECT name, host, role, last_start, last_ok, last_error, last_error_at, last_ms, runs, fails, skips, updated_at
       FROM job_heartbeats ORDER BY name, role`);
  return rows;
}

module.exports = { wrap, lockedCron, status, flushHeartbeats, usesSocket, nameFor, _state: state };
