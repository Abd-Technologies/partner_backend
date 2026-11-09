/**
 * crmOutboxSender.js — delivers CrmOutbox rows to the CRM (Nov 2026).
 *
 * Runs every 30 s from app.js. Each run:
 *   1. Frees rows stuck in "sending" for 5+ minutes (a crash mid-send).
 *   2. Claims up to 50 due rows with a unique lockId (safe if two app
 *      instances run the job at the same time).
 *   3. Sends each, oldest first, signed with APP_WEBHOOK_SECRET:
 *        x-webhook-timestamp: <unix seconds>
 *        x-webhook-signature: sha256=HMAC("<timestamp>.<body>")
 *      body = { event_type, payload, external_event_id }
 *   4. 2xx → sent. 400 → dead (bad event, retrying won't help).
 *      Anything else (CRM down, 5xx, 409 busy, 403 config) → retry after
 *      1 m, 5 m, 15 m, 1 h, then every 6 h. After 24 h → dead + admin alert.
 *   If one of her events fails, her later events in the same run wait, so
 *   the CRM receives each woman's events in order.
 *
 * Also exports cleanup(): deletes sent rows older than 30 days.
 */
const crypto = require("crypto");
const axios = require("axios");
const { Op } = require("sequelize");

const BATCH = 50;
const BACKOFF_SEC = [60, 300, 900, 3600, 21600];
const DEAD_AFTER_HOURS = 24;
const STUCK_SENDING_MIN = 5;

let running = false;

function models() {
  return require("../models");
}

function sign(secret, ts, raw) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
}

async function deliver(row) {
  const url = process.env.CRM_WEBHOOK_URL;
  const secret = process.env.APP_WEBHOOK_SECRET;
  // MariaDB stores JSON columns as text, so the payload can come back as a
  // string. Always send the object, never a JSON string inside JSON.
  let payload = row.payload;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (_) {
      return { ok: false, permanent: true, status: null, error: "payload is not valid JSON" };
    }
  }
  const raw = JSON.stringify({
    event_type: row.eventType,
    payload,
    external_event_id: row.eventId,
  });
  const ts = Math.floor(Date.now() / 1000);
  try {
    const res = await axios.post(url, raw, {
      headers: {
        "Content-Type": "application/json",
        "x-webhook-timestamp": String(ts),
        "x-webhook-signature": sign(secret, ts, raw),
      },
      timeout: 15000,
      validateStatus: () => true,
      transformRequest: [(d) => d], // send the exact signed bytes
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data || {});
    return { ok: false, permanent: res.status === 400, status: res.status, error: `HTTP ${res.status} ${body}`.slice(0, 500) };
  } catch (err) {
    return { ok: false, permanent: false, status: null, error: (err.code || err.message || "network error").toString().slice(0, 500) };
  }
}

async function runOnce() {
  if (running) return { skipped: "already running" };
  if (!require("./crmEvents").enabled()) return { skipped: "disabled" };
  running = true;
  const summary = { sent: 0, retry: 0, dead: 0 };
  try {
    const { CrmOutbox, sequelize } = models();

    await CrmOutbox.update(
      { status: "pending", lockId: null, lockedAt: null },
      { where: { status: "sending", lockedAt: { [Op.lt]: new Date(Date.now() - STUCK_SENDING_MIN * 60000) } } }
    );

    const lockId = crypto.randomUUID();
    await sequelize.query(
      "UPDATE `CrmOutbox` SET status = 'sending', lockId = :lockId, lockedAt = NOW() " +
        "WHERE status = 'pending' AND nextAttemptAt <= NOW() ORDER BY id ASC LIMIT :n",
      { replacements: { lockId, n: BATCH } }
    );
    const rows = await CrmOutbox.findAll({ where: { lockId }, order: [["id", "ASC"]] });

    const heldUsers = new Set();
    for (const row of rows) {
      if (row.userId && heldUsers.has(row.userId)) {
        await row.update({ status: "pending", lockId: null, lockedAt: null });
        continue;
      }
      const r = await deliver(row);
      const attempts = row.attempts + 1;
      if (r.ok) {
        await row.update({ status: "sent", sentAt: new Date(), attempts, lockId: null, lockedAt: null, lastError: null });
        summary.sent++;
        continue;
      }
      if (row.userId) heldUsers.add(row.userId);
      const ageHours = (Date.now() - new Date(row.createdAt).getTime()) / 3.6e6;
      if (r.permanent || ageHours >= DEAD_AFTER_HOURS) {
        await row.update({ status: "dead", attempts, lockId: null, lockedAt: null, lastError: r.error });
        summary.dead++;
        require("./opsAlert")
          .opsAlert(
            "crm-outbox-dead",
            "CRM sync failed",
            `Event ${row.eventType} for user ${row.userId} could not be delivered to the CRM: ${r.error}`,
            { everyMinutes: 60 }
          )
          .catch(() => {});
      } else {
        const wait = BACKOFF_SEC[Math.min(attempts - 1, BACKOFF_SEC.length - 1)];
        await row.update({
          status: "pending",
          attempts,
          nextAttemptAt: new Date(Date.now() + wait * 1000),
          lockId: null,
          lockedAt: null,
          lastError: r.error,
        });
        summary.retry++;
      }
    }
    if (summary.sent || summary.retry || summary.dead) {
      console.log(`[crm-outbox] sent ${summary.sent}, retry ${summary.retry}, dead ${summary.dead}`);
    }
    return summary;
  } catch (err) {
    console.error("[crm-outbox] run failed:", err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

async function cleanup() {
  try {
    const { CrmOutbox } = models();
    const n = await CrmOutbox.destroy({
      where: { status: "sent", sentAt: { [Op.lt]: new Date(Date.now() - 30 * 86400000) } },
    });
    if (n) console.log(`[crm-outbox] cleaned ${n} old sent rows`);
  } catch (err) {
    console.error("[crm-outbox] cleanup failed:", err.message);
  }
}

module.exports = { runOnce, cleanup, deliver, sign };
