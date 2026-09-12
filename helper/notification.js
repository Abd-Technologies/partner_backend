const admin = require('firebase-admin');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const { User, NotificationPreference, UserNotification } = require('../models');
const serviceAccount = require('../fither-e7a36-2145b07b5e5a.json');
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

  // ── Transactional — no preference gate (always deliver) ─────────────
  dietPlanUpdated:        null,
  dietPlanAdded:          null,
  dietPlanReady:          null,
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
        attributes: ['id', 'deviceToken'],
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

          // Gate: is this pref column enabled?
          if (!pref[prefKey]) return;

          // Quiet-hours gate (PKT default; no per-user TZ stored yet).
          const now = moment().tz(DEFAULT_TZ);
          const nowMin = now.hours() * 60 + now.minutes();
          const toMin = (str) => {
            const [h, m] = (str || '').split(':').map(Number);
            return (h || 0) * 60 + (m || 0);
          };
          const qs = toMin(pref.quietStart || '22:00');
          const qe = toMin(pref.quietEnd   || '07:00');
          // Wraps midnight when quietStart > quietEnd.
          const inQuiet = qs > qe
            ? (nowMin >= qs || nowMin < qe)
            : (nowMin >= qs && nowMin < qe);
          if (inQuiet) return;

          eligible.add(user.deviceToken);
        } catch (e) {
          // Preference lookup failure → send anyway (fail-open).
          eligible.add(user.deviceToken);
        }
      }));

      eligibleTokens = tokens.filter(t => eligible.has(t));
    }

    if (eligibleTokens.length === 0) {
      console.log('[notification] All tokens filtered by preferences — skipping.');
      return { successCount: 0, failureCount: 0 };
    }

    // ── 4. Build and send FCM multicast ──────────────────────────────────
    // All data values must be strings per FCM spec.
    const dataPayload = Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, String(v)])
    );

    const message = {
      tokens: eligibleTokens,
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
          aps: { sound: 'default', badge: 1 },
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `[notification] type=${type || 'unknown'} ` +
      `success=${response.successCount} failed=${response.failureCount}`
    );

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
