const admin = require('firebase-admin');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const { User, NotificationPreference, UserNotification } = require('../models');
const serviceAccount = require('../fither-e7a36-2600b985f356.json');
const { REENGAGEMENT_PREF_BY_TYPE } = require('./notifications/_types');

// Initialize Firebase Admin SDK. Guard prevents "already exists" crash if
// another module (e.g. appNotifyController) initialised admin first.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const DEFAULT_TZ = 'Asia/Karachi';

// Maps notification title → type string for callers that don't pass an
// explicit type in the data payload.
const TYPE_BY_TITLE = {
  'Diet Plan Updated': 'dietPlanUpdated',
  'Diet Plan Added': 'dietPlanAdded',
  'Class Link Added': 'classLinkAdded',
  'Class link Added': 'classLinkAdded',
  'Trainer link Added': 'trainerLinkAdded',
  'A New user Assigned to you': 'csrUserAssigned',
  Announcements: 'announcement',
  'Approve Request': 'paymentApprovalRequest',
  'Request Rejected': 'paymentRejected',
  'Congratulations!': 'paymentApproved',
  'Plan activated!': 'planActivated',
  'Booking Pending': 'bookingPending',
  'Booking Added': 'bookingAdded',
  'Appointment Canceled': 'appointmentCanceled',
  'Appointment Cancelled': 'appointmentCanceled',
  'Appointment Confirmed': 'appointmentConfirmed',
  'Plan Paused': 'planPaused',
  'Plan Resumed': 'planResumed',
  'Your Diet Plan is Ready': 'dietPlanReady',
  'Class Reminder': 'classPrep',
  'Upcoming Class': 'upcomingClass',
  'Trainer has Joined': 'classStart',
  'Missed Session': 'missedRecovery',
  // Slot status change titles (used in update_slot_status)
  'Class Cancelled': 'trainerCancelled',
  'Sweat Now, Selfies Later': 'classStart',
  "User hasn't booked": 'escalation',
  'Plan delivery delayed': 'escalation',
  'Consultation no-show reported': 'escalation',
  'Day 7 review flagged': 'escalation',
};

// Maps notification type → NotificationPreference column that gates it.
// null = transactional (always send, no user preference check).
const PREF_BY_TYPE = {
  // ── Class notifications ───────────────────────────────────────────────
  classLinkAdded:         'classStart',
  trainerLinkAdded:       'classStart',
  classStart:             'classStart',
  classPrep:              'classPrep',
  upcomingClass:          'classPrep',
  missedRecovery:         'missedRecovery',
  trainerCancelled:       'trainerCancelled',

  // ── Diet plan: her "Diet plan updates" switch (Oct 2026; was always sent)
  dietPlanUpdated:        'dietUpdates',
  dietPlanAdded:          'dietUpdates',
  dietPlanReady:          'dietUpdates',

  // ── Transactional — no preference gate (always deliver) ─────────────
  paymentApprovalRequest: null,
  paymentRejected:        null,
  paymentApproved:        null,
  planActivated:          null,
  bookingPending:         null,
  bookingAdded:           null,
  appointmentCanceled:    null,
  appointmentConfirmed:   null,
  planPaused:             null,
  planResumed:            null,
  csrUserAssigned:        null,
  announcement:           null,
  escalation:             null,
  planExpiring:           null,

  // ── Re-engagement / lifecycle (morningNudge + weeklyCheckin) ─────────
  ...REENGAGEMENT_PREF_BY_TYPE,
};

/**
 * Send a push notification to one or more FCM device tokens.
 *
 * @param {string|string[]} deviceTokens   - FCM registration token(s).
 * @param {{ title: string, body: string }} notification
 * @param {{ type?: string, [key: string]: any }} data
 *   - `type` drives the NotificationPreference gate.
 *   - All keys are stringified and sent as the FCM data payload.
 * @returns {Promise<{ successCount: number, failureCount: number }>}
 */
// ── Quiet hours: NOT A SINGLE push to a client during her quiet hours ──
// (Oct 2026 product rule: no exceptions — reminders, cancellations,
// payments, support replies all wait.) Evaluated in her own time zone,
// falling back to Pakistan time. Default 23:30–07:00 when she never set
// it. Staff accounts (trainers, dietitians, admins…) are never muted.
function inQuietWindow(pref, tz) {
  const now = moment().tz(tz || DEFAULT_TZ);
  const nowMin = now.hours() * 60 + now.minutes();
  const toMin = (str) => {
    const [h, m] = String(str || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const qs = toMin((pref && pref.quietStart) || '23:30');
  const qe = toMin((pref && pref.quietEnd) || '07:00');
  if (qs === qe) return false;
  return qs > qe ? (nowMin >= qs || nowMin < qe) : (nowMin >= qs && nowMin < qe);
}

function isClient(user) {
  const t = String((user && user.userType) || 'User').toLowerCase();
  return t === 'user' || t === '';
}

/** True when this user is a client inside her quiet hours right now. */
async function isInQuietHours(userId) {
  try {
    const user = await User.findByPk(userId, { attributes: ['id', 'timeZone', 'userType'] });
    if (!user || !isClient(user)) return false;
    const pref = await NotificationPreference.findOne({ where: { userId } });
    return inQuietWindow(pref, user.timeZone);
  } catch (_) {
    return false;
  }
}

// ── Quiet-hours hold queue (Oct 2026) ──────────────────────────────────
// A push that lands in her quiet hours is no longer thrown away. It waits
// in a redis sorted set (score = when her quiet hours end) and
// releaseHeldPushes() — run every 5 min from app.js — sends it then.
// Pushes about something that will be over by morning (a class starting
// soon, a call in 15 min) are still dropped: they'd only confuse her.
const Redis = require("ioredis");
let redis = null;
function getRedis() {
  if (!redis) redis = new Redis();
  return redis;
}
const HELD_KEY = "quiet:held";
// Pushes she asked for and is waiting on right now: sent even in her
// quiet hours (e.g. the starter plan she requested at 11 pm, Oct 2026).
const IGNORE_QUIET = new Set(['trialPlanReady']);

const DROP_IF_QUIET = new Set([
  "classPrep", "classStart", "upcomingClass", "classLinkAdded", "trainerLinkAdded",
  "trialClassReminder", "consultationReminder", "appointmentStarted",
  "appointmentDietitianLate",
]);

/** Next moment her quiet hours end, as epoch ms. */
function quietEndsAt(pref, tz) {
  const zone = tz || DEFAULT_TZ;
  const [h, m] = String((pref && pref.quietEnd) || "07:00").split(":").map(Number);
  const now = moment().tz(zone);
  let end = now.clone().hours(h || 0).minutes(m || 0).seconds(0).milliseconds(0);
  if (!end.isAfter(now)) end = end.add(1, "day");
  return end.valueOf();
}

// ── Daily nudge limit (Oct 2026) ────────────────────────────────────────
// "Nudges" = encouraging pushes that aren't urgent and aren't about
// something she booked or paid for. At most NUDGE_DAILY_MAX a day per
// woman (her own calendar day). Extra ones are lined up for tomorrow
// (10:00 her time) and go through this same limit again then.
// Everything else is ESSENTIAL and never counted: classes, consultations,
// payment & plan, diet plan ready, support replies, chat, app update,
// announcements, health form, daily log reminder.
const NUDGE_DAILY_MAX = 3;
const NUDGE_RELEASE_HOUR = 10;
const NUDGE_TYPES = new Set([
  'weeklyCheckin',        // weekly / Day 7 / halfway / end-of-plan check-in
  'popupReminder',        // follow-up booking, renew plan
  'trialLastDay',         // last day of free trial
  'trialOfferReminder',   // offer ending (switched off for now)
  'symptomCheckReminder', // monthly PCOS / thyroid check
  ...Object.keys(REENGAGEMENT_PREF_BY_TYPE), // win-back & lifecycle
]);

function nudgeTomorrowAt(tz) {
  return moment().tz(tz || DEFAULT_TZ).add(1, 'day')
    .hours(NUDGE_RELEASE_HOUR).minutes(0).seconds(0).milliseconds(0).valueOf();
}

/**
 * Splits tokens into the ones under today's nudge limit and the ones lined
 * up for tomorrow. Staff and unknown tokens are never limited. Fail-open.
 */
async function applyNudgeLimit(tokens) {
  if (!tokens.length) return { now: tokens, later: [] };
  const users = await User.findAll({
    where: { deviceToken: { [Op.in]: tokens } },
    attributes: ['id', 'deviceToken', 'timeZone', 'userType'],
  });
  const r = getRedis();
  const later = [];
  const blocked = new Set();
  for (const u of users) {
    if (!isClient(u)) continue;
    try {
      const day = moment().tz(u.timeZone || DEFAULT_TZ).format('YYYY-MM-DD');
      const key = `nudge:${u.id}:${day}`;
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, 2 * 24 * 3600);
      if (n > NUDGE_DAILY_MAX) {
        await r.decr(key);
        blocked.add(u.deviceToken);
        later.push({ token: u.deviceToken, releaseAt: nudgeTomorrowAt(u.timeZone) });
      }
    } catch (e) {
      // Redis down: send anyway.
    }
  }
  return { now: tokens.filter((t) => !blocked.has(t)), later };
}

async function holdPushes(held, notification, data) {
  if (!held.length) return;
  const r = getRedis();
  for (const { token, releaseAt } of held) {
    const member = JSON.stringify({ token, notification, data, at: Date.now() });
    await r.zadd(HELD_KEY, releaseAt, member);
  }
  console.log(`[notification] quiet hours: holding ${held.length} push(es) until morning`);
}

/**
 * Sends the held pushes whose quiet hours are over. If several pushes of
 * the same type wait for the same phone, only the newest one is sent.
 */
async function releaseHeldPushes() {
  const r = getRedis();
  const now = Date.now();
  const due = await r.zrangebyscore(HELD_KEY, 0, now);
  if (!due.length) return 0;
  await r.zremrangebyscore(HELD_KEY, 0, now);
  const latest = new Map();
  for (const raw of due) {
    try {
      const job = JSON.parse(raw);
      const key = `${job.token}|${(job.data && job.data.type) || job.notification.title}`;
      const prev = latest.get(key);
      if (!prev || job.at >= prev.at) latest.set(key, job);
    } catch (_) {}
  }
  let sent = 0;
  for (const job of latest.values()) {
    try {
      await sendNotification([job.token], job.notification, job.data || {});
      sent++;
    } catch (e) {
      console.error("[notification] held push failed:", e.message);
    }
  }
  return sent;
}

/**
 * Splits tokens into the ones that can go now and the ones held for her
 * quiet hours. Staff accounts are never muted.
 */
async function filterQuietHours(tokens) {
  if (!tokens.length) return { now: tokens, held: [] };
  const users = await User.findAll({
    where: { deviceToken: { [Op.in]: tokens } },
    attributes: ['id', 'deviceToken', 'timeZone', 'userType'],
  });
  const clients = users.filter(isClient);
  if (!clients.length) return { now: tokens, held: [] };
  const prefs = await NotificationPreference.findAll({
    where: { userId: { [Op.in]: clients.map((u) => u.id) } },
    attributes: ['userId', 'quietStart', 'quietEnd'],
  });
  const prefBy = new Map(prefs.map((p) => [p.userId, p]));
  const held = [];
  const muted = new Set();
  for (const u of clients) {
    const pref = prefBy.get(u.id);
    if (!inQuietWindow(pref, u.timeZone)) continue;
    muted.add(u.deviceToken);
    held.push({ token: u.deviceToken, releaseAt: quietEndsAt(pref, u.timeZone) });
  }
  return { now: tokens.filter((t) => !muted.has(t)), held };
}

async function sendNotification(deviceTokens, notification, data = {}) {
  try {
    // ── 1. Normalise + validate tokens ──────────────────────────────────
    const tokens = (Array.isArray(deviceTokens) ? deviceTokens : [deviceTokens])
      .filter(t => typeof t === 'string' && t.trim().length > 0);

    if (tokens.length === 0) {
      console.log('[notification] No valid tokens — skipping.');
      return { successCount: 0, failureCount: 0 };
    }

    // ── 2. Resolve notification type ─────────────────────────────────────
    const type = data?.type || TYPE_BY_TITLE[notification?.title] || null;
    const prefKey = type !== null ? PREF_BY_TYPE[type] : null;

    // ── 3. Filter by NotificationPreference ─────────────────────────────
    let eligibleTokens = tokens;
    // Cached token→userId map — built here and reused in step 5 so we
    // don't make a second identical User query just for logging.
    let tokenUserMap = {};

    if (prefKey) {
      const users = await User.findAll({
        where: { deviceToken: { [Op.in]: tokens } },
        attributes: ['id', 'deviceToken', 'timeZone'],
      });
      // Cache for step 5.
      users.forEach(u => { tokenUserMap[u.deviceToken] = u.id; });

      const eligible = new Set();

      await Promise.all(users.map(async (user) => {
        try {
          const pref = await NotificationPreference.findOne({
            where: { userId: user.id },
          });

          // No pref row → treat as all-enabled (default values).
          if (!pref) {
            eligible.add(user.deviceToken);
            return;
          }

          // Gate: is this pref column enabled? (Quiet hours are handled
          // below for every type, by holding instead of dropping.)
          // Only an explicit "off" (0/false) blocks it, so a missing
          // column never silently stops a whole push type.
          if (pref[prefKey] === 0 || pref[prefKey] === false) return;

          eligible.add(user.deviceToken);
        } catch (e) {
          // Preference lookup failure → send anyway (fail-open).
          eligible.add(user.deviceToken);
        }
      }));

      eligibleTokens = tokens.filter(t => eligible.has(t));
    }

    // Quiet hours apply to EVERY push type (not only the ones with a
    // preference switch). Held, not dropped — except pushes that would be
    // out of date by morning (DROP_IF_QUIET).
    if (!IGNORE_QUIET.has(type)) try {
      const q = await filterQuietHours(eligibleTokens);
      eligibleTokens = q.now;
      if (q.held.length) {
        if (DROP_IF_QUIET.has(type)) {
          console.log(`[notification] quiet hours: dropped ${q.held.length} ${type} push(es) (would be out of date)`);
        } else {
          await holdPushes(q.held, notification, data);
        }
      }
    } catch (e) {
      console.error('[notification] quiet-hours check failed:', e.message);
    }

    // Daily nudge limit: over 3 today → lined up for tomorrow.
    if (NUDGE_TYPES.has(type) && eligibleTokens.length) try {
      const lim = await applyNudgeLimit(eligibleTokens);
      eligibleTokens = lim.now;
      if (lim.later.length) {
        // Last trial day / offer ending would be out of date tomorrow.
        if (type === 'trialLastDay' || type === 'trialOfferReminder') {
          console.log(`[notification] nudge limit: dropped ${lim.later.length} ${type} push(es) (out of date tomorrow)`);
        } else {
          await holdPushes(lim.later, notification, data);
          console.log(`[notification] nudge limit: ${lim.later.length} ${type} push(es) lined up for tomorrow`);
        }
      }
    } catch (e) {
      console.error('[notification] nudge limit check failed:', e.message);
    }

    if (eligibleTokens.length === 0) {
      console.log('[notification] All tokens filtered by preferences / quiet hours — skipping.');
      return { successCount: 0, failureCount: 0 };
    }

    // ── 4. Build and send FCM multicast ──────────────────────────────────
    // All data values must be strings per FCM spec.
    const dataPayload = Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, String(v)])
    );

    const message = {
      notification: {
        title: notification.title || '',
        body:  notification.body  || '',
      },
      data: dataPayload,
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          sound: 'default',
        },
      },
      apns: {
        payload: {
          // Oct 2026: was badge 1 on every push and the app never cleared
          // it, so iPhones showed a "1" on the icon for ever. 0 = no number
          // (and it clears the old stuck "1" with her next push).
          aps: { sound: 'default', badge: 0 },
        },
      },
    };

    // FCM takes at most 500 tokens per call (Oct 2026): before, a send to
    // more than 500 phones (an announcement to everyone) failed completely
    // and reached nobody. Send in batches of 500 and add up the results;
    // `responses` stays in the same order as eligibleTokens.
    const FCM_BATCH = 500;
    const response = { successCount: 0, failureCount: 0, responses: [] };
    for (let i = 0; i < eligibleTokens.length; i += FCM_BATCH) {
      const batch = eligibleTokens.slice(i, i + FCM_BATCH);
      try {
        const r = await admin.messaging().sendEachForMulticast({ ...message, tokens: batch });
        response.successCount += r.successCount;
        response.failureCount += r.failureCount;
        response.responses.push(...r.responses);
      } catch (e) {
        // One batch failing must not stop the others.
        console.error(`[notification] batch ${i / FCM_BATCH + 1} failed:`, e.message);
        response.failureCount += batch.length;
        batch.forEach(() =>
          response.responses.push({ success: false, error: { code: 'batch-failed', message: e.message } })
        );
      }
    }
    console.log(
      `[notification] type=${type || 'unknown'} ` +
      `success=${response.successCount} failed=${response.failureCount}`
    );

    // Dead tokens (app uninstalled / token replaced): clear them so they
    // aren't retried for ever. The app sends a fresh token on its next
    // start (syncTokenIfAllowed / onTokenRefresh).
    try {
      const DEAD = new Set([
        'messaging/registration-token-not-registered',
        'messaging/invalid-registration-token',
      ]);
      const dead = [];
      response.responses.forEach((res, idx) => {
        if (!res.success && res.error && DEAD.has(res.error.code)) dead.push(eligibleTokens[idx]);
      });
      if (dead.length) {
        const [n] = await User.update({ deviceToken: null }, { where: { deviceToken: { [Op.in]: dead } } });
        console.log(`[notification] cleared ${n} dead device token(s)`);
      }
    } catch (e) {
      console.error('[notification] dead-token cleanup failed:', e.message);
    }

    // ── 5. Persist to UserNotification (notification centre) ─────────────
    try {
      const sentAt = new Date();
      const rows = [];

      response.responses.forEach((res, idx) => {
        const token = eligibleTokens[idx];
        rows.push({
          type:            type || 'general',
          title:           notification.title || '',
          body:            notification.body  || '',
          data:            data || {},
          deviceToken:     token,
          deliveryStatus:  res.success ? 'sent' : 'failed',
          errorCode:       res.error?.code    || null,
          errorMessage:    res.error?.message || null,
          sentAt,
        });
      });

      // Resolve userId per token. Reuse the cache from step 3 when the
      // pref gate ran; otherwise fetch now (transactional / no-gate path).
      if (Object.keys(tokenUserMap).length === 0) {
        const usersForLog = await User.findAll({
          where: { deviceToken: { [Op.in]: eligibleTokens } },
          attributes: ['id', 'deviceToken'],
        });
        usersForLog.forEach(u => { tokenUserMap[u.deviceToken] = u.id; });
      }
      rows.forEach(r => { r.userId = tokenUserMap[r.deviceToken] || null; });

      await UserNotification.bulkCreate(rows, { ignoreDuplicates: true });
    } catch (logErr) {
      // Non-fatal — notification already sent.
      console.error('[notification] UserNotification log failed:', logErr.message);
    }

    return response;
  } catch (err) {
    console.error('[notification] sendNotification error:', err.message);
    return { successCount: 0, failureCount: 0, error: err.message };
  }
}

module.exports = sendNotification;
module.exports.isInQuietHours = isInQuietHours;
module.exports.releaseHeldPushes = releaseHeldPushes;
