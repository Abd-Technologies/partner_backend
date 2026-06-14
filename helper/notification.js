const admin = require('firebase-admin');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const { User, NotificationPreference, UserNotification } = require('../models');
const serviceAccount = require('../fither-e7a36-2145b07b5e5a.json');

// Initialize Firebase Admin SDK using the service account JSON file
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const DEFAULT_TZ = 'Asia/Karachi';

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
  'Your Diet Plan is Ready': 'dietPlanReady',
  'Class Reminder': 'classPrep',
  'Upcoming Class': 'upcomingClass',
  'Trainer has Joined': 'classStart',
  'Missed Session': 'missedRecovery',
  "User hasn't booked": 'escalation',
  'Plan delivery delayed': 'escalation',
  'Consultation no-show reported': 'escalation',
  'Day 7 review flagged': 'escalation',
};

const PREF_BY_TYPE = {
  classLinkAdded: 'classPrep',
  trainerLinkAdded: 'classPrep',
  classPrep: 'classPrep',
  classStart: 'classStart',
  upcomingClass: 'classStart',
  missedRecovery: 'missedRecovery',
  appointmentCanceled: 'trainerCancelled',
};

const QUIET_HOURS_BYPASS_TYPES = new Set([
  'announcement',
  'bookingPending',
  'bookingAdded',
  'csrUserAssigned',
  'dietPlanAdded',
  'dietPlanReady',
  'dietPlanUpdated',
  'escalation',
  'paymentApprovalRequest',
  'paymentApproved',
  'paymentRejected',
  'planActivated',
  'planPaused',
]);

function notificationType(notificationValue, data = {}) {
  return data.type || TYPE_BY_TITLE[notificationValue?.title] || 'general';
}

function stringifyData(data) {
  return Object.fromEntries(
    Object.entries(data || {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ])
  );
}

function minutesFromHHMM(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function inQuietHours(pref, timeZone) {
  const start = minutesFromHHMM(pref?.quietStart);
  const end = minutesFromHHMM(pref?.quietEnd);
  if (start == null || end == null || start === end) return false;

  const now = moment().tz(timeZone || DEFAULT_TZ);
  const current = now.hours() * 60 + now.minutes();

  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
}

async function tokensAllowedByPreferences(tokens, type) {
  const prefKey = PREF_BY_TYPE[type];
  const shouldCheckQuietHours = !QUIET_HOURS_BYPASS_TYPES.has(type);

  if (!prefKey && !shouldCheckQuietHours) {
    return tokens;
  }

  const users = await User.findAll({
    where: { deviceToken: { [Op.in]: tokens } },
    attributes: ['id', 'deviceToken', 'timeZone'],
  });

  const userByToken = new Map(users.map((user) => [user.deviceToken, user]));
  const prefs = await NotificationPreference.findAll({
    where: { userId: { [Op.in]: users.map((user) => user.id) } },
  });
  const prefByUserId = new Map(prefs.map((pref) => [pref.userId, pref]));

  return tokens.filter((token) => {
    const user = userByToken.get(token);
    if (!user) return true;

    const pref = prefByUserId.get(user.id) || {
      quietStart: '22:00',
      quietEnd: '07:00',
    };
    if (prefKey && pref && Number(pref[prefKey]) === 0) {
      return false;
    }
    if (shouldCheckQuietHours && pref && inQuietHours(pref, user.timeZone)) {
      return false;
    }
    return true;
  });
}

async function usersByToken(tokens) {
  const users = await User.findAll({
    where: { deviceToken: { [Op.in]: tokens } },
    attributes: ['id', 'deviceToken'],
  });
  return new Map(users.map((user) => [user.deviceToken, user]));
}

async function recordNotifications(tokens, notificationValue, data, type, response) {
  try {
    const userByToken = await usersByToken(tokens);
    const rows = tokens.map((token, index) => {
      const item = response?.responses?.[index];
      return {
        userId: userByToken.get(token)?.id ?? null,
        type,
        title: notificationValue?.title ?? '',
        body: notificationValue?.body ?? null,
        data,
        deviceToken: token,
        deliveryStatus: item?.success === false ? 'failed' : 'sent',
        errorCode: item?.error?.code ?? null,
        errorMessage: item?.error?.message ?? null,
        sentAt: new Date(),
      };
    });

    if (rows.length > 0) {
      await UserNotification.bulkCreate(rows);
    }
  } catch (error) {
    console.error('Error recording notifications:', error);
  }
}

// Function to send notification using Firebase Admin SDK
async function sendNotification(to, notificationValue, data = {}, options = {}) {

  try {
    const tokens = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
    if (tokens.length === 0) return null;

    const type = options.type || notificationType(notificationValue, data);
    const payloadData = stringifyData({ ...data, type });
    const allowedTokens = options.bypassPreferences
      ? tokens
      : await tokensAllowedByPreferences(tokens, type);

    if (allowedTokens.length === 0) {
      console.log(`Notification skipped by preferences: ${type}`);
      return { successCount: 0, failureCount: 0, responses: [] };
    }

    // Note: Using sendMulticast requires a flat object with tokens, not within the message
    const response = await admin.messaging().sendEachForMulticast({
      tokens: allowedTokens, // Pass tokens directly here
      notification:notificationValue, // Pass notification separately
      data:payloadData, // Pass data separately
    });
    await recordNotifications(allowedTokens, notificationValue, payloadData, type, response);
    // const response = await admin.messaging().sendMulticast(message); // Use sendMulticast instead of sendEachForMulticast

    console.log(JSON.stringify(response));
    return response;
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

module.exports = sendNotification;


/**
 * 🔔 Send notification to a Firebase Topic
 * @param {string} topicName - The Firebase topic name (e.g. "userPlan")
 * @param {Object} notificationValue - { title, body, image }
 * @param {Object} data - Optional custom payload
 */
module.exports.sendTopicNotification = async function sendTopicNotification(topicName, notificationValue, data = {}) {
  try {
    const message = {
      topic: topicName,
      notification: notificationValue,
      data: data,
    };

    const response = await admin.messaging().send(message);
    console.log(`✅ Notification sent to topic "${topicName}":`, response);
  } catch (error) {
    console.error(`❌ Error sending topic notification:`, error);
  }
};
