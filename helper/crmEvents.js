// CRM events (Nov 2026): tell the Fit Her CRM what happened in the app so
// sales reps see it (signups, purchases, payment rejected, plan expired /
// frozen / unfrozen, support tickets).
//
//   emit(eventType, payload, externalEventId)   queue + try to send now.
//                                               Never throws, never blocks a flow.
//   flush()                                     minute cron: resend what's due.
//
// Saved in CrmOutbox first (models/CrmOutbox.js), so a CRM outage only
// delays events. Signed the "v2" way the CRM expects
// (fithercrm src/app_integration/webhookVerifier.js):
//   x-webhook-timestamp: <unix s>
//   x-webhook-signature: sha256=HMAC(APP_WEBHOOK_SECRET, "<ts>.<raw body>")
// The CRM answers 200 = done, 400 = bad event (don't retry), 409/5xx = retry.
//
// .env: CRM_WEBHOOK_URL (…/api/webhooks/app/event), APP_WEBHOOK_SECRET
// (same value as the CRM's APP_WEBHOOK_SECRET). No CRM_WEBHOOK_URL = off.
const crypto = require("crypto");
const axios = require("axios");
const { Op } = require("sequelize");

const models = () => require("../models");
const RETRY_MIN = [1, 2, 5, 15, 30, 60, 120, 240, 480]; // then every 12 h
const MAX_ATTEMPTS = 30;
const CLAIM_MS = 2 * 60 * 1000; // a send in progress holds the row this long

const enabled = () => !!process.env.CRM_WEBHOOK_URL;

function nextDelayMs(attempts) {
  const min = RETRY_MIN[attempts - 1];
  return (min != null ? min : 12 * 60) * 60 * 1000;
}

/** Queue an event for the CRM. payload must carry app_user_id. */
async function emit(eventType, payload, externalEventId) {
  try {
    if (!enabled()) return null;
    if (!payload || payload.app_user_id == null || !externalEventId) {
      console.error(`[crmEvents] ${eventType}: missing app_user_id or event id, not queued`);
      return null;
    }
    const body = { ...payload, occurred_at: payload.occurred_at || new Date().toISOString() };
    const { CrmOutbox } = models();
    const [row, created] = await CrmOutbox.findOrCreate({
      where: { externalEventId: String(externalEventId).slice(0, 120) },
      defaults: {
        eventType,
        appUserId: Number(payload.app_user_id) || null,
        payload: JSON.stringify(body),
        // 1 s in the past: MySQL DATETIME drops milliseconds and may round
        // UP, which made the immediate send skip the row as "not due yet".
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });
    if (created) setImmediate(() => sendRow(row.id).catch(() => {}));
    return row;
  } catch (e) {
    console.error(`[crmEvents] emit ${eventType}:`, e.message);
    return null;
  }
}

/** Claim one row (so two sends never overlap), send it, record the outcome. */
async function sendRow(id) {
  const { CrmOutbox } = models();
  const now = new Date();
  const [claimed] = await CrmOutbox.update(
    { nextAttemptAt: new Date(now.getTime() + CLAIM_MS) },
    { where: { id, status: "pending", nextAttemptAt: { [Op.lte]: now } } }
  );
  if (!claimed) return "busy";
  const row = await CrmOutbox.findByPk(id);
  const secret = process.env.APP_WEBHOOK_SECRET;
  const url = process.env.CRM_WEBHOOK_URL;
  if (!url || !secret) {
    await row.update({ nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000), lastError: "CRM_WEBHOOK_URL / APP_WEBHOOK_SECRET not set" });
    return "not_configured";
  }

  let payload;
  try { payload = JSON.parse(row.payload); } catch (_) { payload = {}; }
  const raw = JSON.stringify({ event_type: row.eventType, payload, external_event_id: row.externalEventId });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const attempts = row.attempts + 1;

  try {
    await axios.post(url, raw, {
      headers: { "Content-Type": "application/json", "x-webhook-timestamp": ts, "x-webhook-signature": `sha256=${sig}` },
      timeout: 15000,
      transformRequest: [(d) => d], // send exactly the signed bytes
    });
    await row.update({ status: "sent", attempts, sentAt: new Date(), lastError: null });
    return "sent";
  } catch (err) {
    const code = err.response && err.response.status;
    const detail = String(JSON.stringify((err.response && err.response.data) || err.message)).slice(0, 480);
    if (code === 400) {
      // The CRM says the event itself is wrong: retrying can't help.
      await row.update({ status: "dead", attempts, lastError: `400 ${detail}` });
      console.error(`[crmEvents] ${row.eventType} #${row.id} rejected by CRM:`, detail);
      return "dead";
    }
    const giveUp = attempts >= MAX_ATTEMPTS;
    await row.update({
      status: giveUp ? "dead" : "pending",
      attempts,
      lastError: `${code || "no-response"} ${detail}`,
      nextAttemptAt: new Date(Date.now() + (code === 409 ? 60 * 1000 : nextDelayMs(attempts))),
    });
    if (attempts === 1 || giveUp) console.error(`[crmEvents] ${row.eventType} #${row.id} not delivered (${code || "no-response"})${giveUp ? " — gave up" : ", will retry"}`);
    return giveUp ? "dead" : "retry";
  }
}

let flushing = false;
/** Minute cron: send everything due, oldest first. */
async function flush(limit = 50) {
  if (!enabled() || flushing) return 0;
  flushing = true;
  try {
    const { CrmOutbox } = models();
    const due = await CrmOutbox.findAll({
      where: { status: "pending", nextAttemptAt: { [Op.lte]: new Date() } },
      attributes: ["id"],
      order: [["id", "ASC"]],
      limit,
    });
    let sent = 0;
    for (const r of due) if ((await sendRow(r.id)) === "sent") sent++;
    // Keep the table small: delivered rows older than 30 days.
    if (Math.random() < 0.02) {
      await CrmOutbox.destroy({ where: { status: "sent", sentAt: { [Op.lt]: new Date(Date.now() - 30 * 86400000) } } });
    }
    return sent;
  } catch (e) {
    console.error("[crmEvents] flush:", e.message);
    return 0;
  } finally {
    flushing = false;
  }
}

/** Last N outbox rows, for the signed /internal/crm/outbox status check. */
async function recent(limit = 20) {
  const { CrmOutbox } = models();
  const rows = await CrmOutbox.findAll({
    attributes: ["id", "eventType", "externalEventId", "appUserId", "status", "attempts", "nextAttemptAt", "lastError", "sentAt", "createdAt"],
    order: [["id", "DESC"]],
    limit: Math.min(100, Math.max(1, limit)),
  });
  const counts = {};
  for (const r of await CrmOutbox.findAll({ attributes: ["status"] })) counts[r.status] = (counts[r.status] || 0) + 1;
  let columns = null;
  try {
    const desc = await CrmOutbox.sequelize.getQueryInterface().describeTable(CrmOutbox.getTableName());
    columns = Object.fromEntries(Object.entries(desc).map(([k, v]) => [k, `${v.type}${v.allowNull ? "" : " NOT NULL"}`]));
  } catch (_) {}
  return { enabled: enabled(), counts, columns, rows };
}

module.exports = { emit, flush, sendRow, recent };
