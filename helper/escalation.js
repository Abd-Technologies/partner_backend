const Queue = require("bull");
const {
  EscalationTicket,
  User,
} = require("../models");

const notificationQueue = new Queue("notificationQueue", {
  redis: { host: "127.0.0.1", port: 6379 },
});

// Section 12 — every escalation notifies dietitian + admin simultaneously,
// EXCEPT SYSTEM_ISSUE which is admin-only.
const DIETITIAN_NOTIFIED_TRIGGERS = new Set([
  "PLAN_DELAYED",
  "CONSULT_NO_SHOW",
  "MEDICAL",
  "REVIEW_FLAG",
]);

// User-facing notification copy. Kept inline (small, easy to tweak per
// trigger). The actual FCM payload uses these strings; the in-app screen
// loads its own UI from PendingPopupState anyway.
const COPY = {
  PLAN_DELAYED: {
    title: "Plan delivery delayed",
    body: "A user is waiting on a delayed diet plan. Tap to review.",
  },
  CONSULT_NO_SHOW: {
    title: "Consultation no-show reported",
    body: "A user reported you didn't join the consultation. Tap to respond.",
  },
  INACTIVITY: {
    title: "User went inactive",
    body: "A workout user has missed 3+ days of sessions.",
  },
  MEDICAL: {
    title: "Medical concern reported",
    body: "A user reported a medical issue and needs immediate attention.",
  },
  REVIEW_FLAG: {
    title: "Day 7 review flagged",
    body: "A review tripped flag thresholds. Tap to review.",
  },
  BOOKING_REMINDER_5X: {
    title: "User hasn't booked",
    body: "A user has ignored 5 booking reminders. Manual outreach needed.",
  },
  SYSTEM_ISSUE: {
    title: "System issue",
    body: "Backend reported a system-level issue. Tap for details.",
  },
};

// Lazy admin-tokens fetch. Cached for 60s so a burst of escalations doesn't
// spam User.findAll. Admin set is small (handful of accounts) so a stale
// cache window is fine.
let _adminCache = { tokens: [], expiresAt: 0 };
async function getAdminDeviceTokens() {
  const now = Date.now();
  if (now < _adminCache.expiresAt) return _adminCache.tokens;
  try {
    const admins = await User.findAll({
      where: { userType: "Admin" },
      attributes: ["id", "deviceToken"],
    });
    const tokens = admins
      .map((u) => u.deviceToken)
      .filter((t) => typeof t === "string" && t.length > 0);
    _adminCache = { tokens, expiresAt: now + 60_000 };
    return tokens;
  } catch (e) {
    console.error("[escalation] admin tokens fetch failed:", e);
    return [];
  }
}

// Push a notification onto the existing Bull queue. The notificationWorker
// picks it up and calls helper/notification.js — same path the slot
// notification flow uses today.
async function queueNotification(tokens, title, body, data = {}) {
  if (!Array.isArray(tokens) || tokens.length === 0) return;
  try {
    await notificationQueue.add({
      title,
      body,
      data: { ...data, kind: "escalation" },
      deviceTokens: tokens,
    });
  } catch (e) {
    console.error("[escalation] queue add failed:", e);
  }
}

// Centralised escalation creation. Replaces the inline EscalationTicket
// .create blocks in controllers — those still work, but routing via this
// helper guarantees the dietitian + admin fan-out happens consistently
// instead of relying on each controller to remember to do it.
//
// Returns the created ticket. Notification queueing is fire-and-forget;
// even if the queue is unhealthy the ticket persists in the DB so an
// admin can still resolve it manually.
async function createEscalation({
  userId,
  dietitianId = null,
  trigger,
  severity = "medium",
  payload = null,
}) {
  const ticket = await EscalationTicket.create({
    userId,
    dietitianId,
    trigger,
    severity,
    status: "open",
    payload,
    notifiedDietitian: false,
    notifiedAdmin: false,
  });

  const copy = COPY[trigger] || {
    title: "Escalation",
    body: "An escalation was opened. Tap to review.",
  };
  const payloadData = {
    ticketId: String(ticket.id),
    trigger,
    severity,
    userId: String(userId),
  };

  // Dietitian fan-out — only for triggers that apply, and only if a
  // dietitianId was provided.
  let notifiedDietitian = false;
  if (DIETITIAN_NOTIFIED_TRIGGERS.has(trigger) && dietitianId) {
    try {
      const dietitian = await User.findByPk(dietitianId, {
        attributes: ["deviceToken"],
      });
      const tok = dietitian && dietitian.deviceToken;
      if (tok) {
        await queueNotification([tok], copy.title, copy.body, payloadData);
        notifiedDietitian = true;
      }
    } catch (e) {
      console.error("[escalation] dietitian notify failed:", e);
    }
  }

  // Admin fan-out — always, for every trigger (Section 12).
  let notifiedAdmin = false;
  try {
    const tokens = await getAdminDeviceTokens();
    if (tokens.length > 0) {
      await queueNotification(tokens, copy.title, copy.body, payloadData);
      notifiedAdmin = true;
    }
  } catch (e) {
    console.error("[escalation] admin notify failed:", e);
  }

  if (notifiedDietitian || notifiedAdmin) {
    try {
      await ticket.update({ notifiedDietitian, notifiedAdmin });
    } catch (e) {
      console.error("[escalation] flag update failed:", e);
    }
  }

  return ticket;
}

module.exports = {
  createEscalation,
};
