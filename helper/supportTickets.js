// Shared logic for support tickets (Report an issue).
// Used by the user endpoints, the Admin endpoints and the CRM webhook, so a
// reply behaves the same whoever sends it.

const crypto = require("crypto");
const axios = require("axios");
const admin = require("firebase-admin");
const { User, UserPlan, Plan, SupportTicketMessage } = require("../models");

// firebase-admin is normally initialised in helper/notification.js. Guard in
// case this file loads first.
if (!admin.apps.length) {
  try {
    const serviceAccount = require("../fither-e7a36-2145b07b5e5a.json");
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (e) {
    console.error("[supportTickets] firebase init skipped:", e.message);
  }
}

const STATUSES = ["received", "in_review", "resolved"];
const CATEGORIES = ["APP_ISSUE", "CLASS", "PAYMENT", "PLAN", "ACCOUNT", "OTHER", "MEDICAL"];

// Date + n working days (Sat/Sun skipped).
function addWorkingDays(from, n) {
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function fullName(u) {
  if (!u) return null;
  const n = `${u.firstName || ""} ${u.lastName || ""}`.trim();
  return n || u.name || null;
}

async function getUserPlan(userId) {
  try {
    const up = await UserPlan.findOne({ where: { userId }, order: [["createdAt", "DESC"]] });
    if (!up) return null;
    let title = null;
    try {
      const pl = await Plan.findByPk(up.PlanId);
      title = (pl && pl.title) || null;
    } catch (_) { /* ignore */ }
    return {
      title,
      status: up.planStatus || (up.status ? "active" : "inactive"),
      expires: up.expireDate ? new Date(up.expireDate).toISOString().slice(0, 10) : null,
    };
  } catch (_) {
    return null;
  }
}

function publicUrl(filename) {
  const base = (process.env.PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/+$/, "");
  return `${base}/public/issueUploads/${filename}`;
}

// Signed webhook to the CRM. Best effort: never throws.
async function sendToCrm(eventType, payload) {
  const crmUrl = process.env.CRM_WEBHOOK_URL;
  const secret = process.env.APP_WEBHOOK_SECRET;
  if (!crmUrl || !secret) {
    console.error("[supportTickets] CRM_WEBHOOK_URL or APP_WEBHOOK_SECRET not configured");
    return false;
  }
  try {
    const raw = JSON.stringify({ event_type: eventType, payload });
    const signature = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
    await axios.post(crmUrl, raw, {
      headers: { "Content-Type": "application/json", "x-webhook-signature": signature },
      timeout: 15000,
    });
    return true;
  } catch (err) {
    console.error("[supportTickets] CRM send failed:", err.response?.data || err.message);
    return false;
  }
}

// Direct push to the user (skips quiet hours: a support reply should arrive).
async function pushToUser(userId, title, body, data) {
  try {
    const user = await User.findByPk(userId, { attributes: ["id", "deviceToken"] });
    if (!user || !user.deviceToken) return;
    const stringData = {};
    Object.entries(data || {}).forEach(([k, v]) => { stringData[k] = String(v); });
    await admin.messaging().send({
      token: user.deviceToken,
      notification: { title, body: String(body).slice(0, 300) },
      data: stringData,
      android: { priority: "high" },
      apns: { payload: { aps: { sound: "default" } } },
    });
  } catch (err) {
    console.error("[supportTickets] push failed:", err.message);
  }
}

/**
 * A staff reply (Admin panel or CRM). Adds the message (if any), updates the
 * status, flags the ticket unread for the user and sends her a push.
 */
async function applyStaffReply(ticket, { body, status, sender, senderId, senderName }) {
  const text = typeof body === "string" ? body.trim() : "";
  const nextStatus = STATUSES.includes(status) ? status : null;
  if (!text && !nextStatus) return { ok: false, message: "Nothing to update" };

  const now = new Date();
  if (text) {
    await SupportTicketMessage.create({
      ticketId: ticket.id,
      sender,
      senderId: senderId || null,
      senderName: senderName || "FitHer Support",
      body: text.slice(0, 4000),
    });
  }
  if (nextStatus) {
    ticket.status = nextStatus;
    ticket.resolvedAt = nextStatus === "resolved" ? now : null;
  } else if (text && ticket.status === "received") {
    ticket.status = "in_review";
  }
  ticket.userUnread = true;
  ticket.adminUnread = false;
  ticket.lastActivityAt = now;
  if (sender === "admin") ticket.handledBy = senderId || null;
  await ticket.save();

  const pushBody = text
    ? text
    : ticket.status === "resolved"
      ? "Your report has been marked as resolved."
      : "Our team is looking into your report.";
  await pushToUser(ticket.userId, "Support replied to your report", pushBody, {
    type: "support_reply",
    ticketId: ticket.id,
  });

  return { ok: true };
}

function ticketJson(t, { messages, client, plan } = {}) {
  const j = {
    id: t.id,
    category: t.category,
    message: t.message,
    imageUrl: t.imageUrl,
    status: t.status,
    dueAt: t.dueAt,
    resolvedAt: t.resolvedAt,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt || t.updatedAt,
    userUnread: !!t.userUnread,
    adminUnread: !!t.adminUnread,
    feedback: t.feedback,
    overdue: t.status !== "resolved" && t.dueAt ? new Date(t.dueAt) < new Date() : false,
  };
  if (messages) {
    j.messages = messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      senderName: m.senderName,
      body: m.body,
      imageUrl: m.imageUrl,
      createdAt: m.createdAt,
    }));
  }
  if (client) {
    j.client = {
      id: client.id,
      name: fullName(client),
      phone: client.phone || null,
      email: client.email || null,
    };
  }
  if (plan !== undefined) j.plan = plan;
  return j;
}

module.exports = {
  STATUSES,
  CATEGORIES,
  addWorkingDays,
  fullName,
  getUserPlan,
  publicUrl,
  sendToCrm,
  pushToUser,
  applyStaffReply,
  ticketJson,
};
