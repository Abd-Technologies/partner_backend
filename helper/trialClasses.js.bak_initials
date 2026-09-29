'use strict';
/**
 * Free trial live classes: no booking. She joins any class; every class
 * she stays in for TRIAL_ATTENDANCE_MIN_SECONDS counts toward her class
 * goal (TRIAL_CLASS_GOAL). During onboarding she picks the class times
 * she wants reminders for (saved in PreConsultationProfile.workoutSection
 * .preferredSlotIds).
 *
 *   countTrialClassesAttended(userId, journey)  progress for the app
 *   listTrialClasses(userId)                    data for the class picker
 *   sendTrialClassReminders()                   5-minute cron
 */
const { Op, fn, col } = require('sequelize');
const moment = require('moment-timezone');
const {
  ClassPresence,
  Slot,
  User,
  TrialJourney,
  PreConsultationProfile,
} = require('../models');
const { normalizeSlotTime } = require('./normalizeSlotTime');
const { minTrialAttendanceSeconds } = require('./trialAttendance');
const { getTrialDays, getJoinWindowMinutes } = require('./trialState');
const sendNotification = require('./notification');

const PKT = 'Asia/Karachi';
const SLOT_FORMAT = 'hh:mm A';

function asJson(v, fallback) {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

/** Slot start as a moment in PKT on the given PKT day, or null. */
function slotMomentOn(slotStart, dayPkt) {
  const norm = normalizeSlotTime(slotStart);
  const t = moment.tz(norm, SLOT_FORMAT, true, PKT);
  if (!t.isValid()) return null;
  return dayPkt.clone().hour(t.hour()).minute(t.minute()).second(0).millisecond(0);
}

function partOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// ── Progress ──────────────────────────────────────────────────────────

/**
 * Number of classes she attended during her trial: distinct
 * (class, day) pairs where she stayed at least the minimum time.
 */
async function countTrialClassesAttended(userId, journey) {
  if (!journey || !journey.startedAt) return 0;
  const start = new Date(journey.startedAt);
  const end = new Date(start.getTime() + getTrialDays() * 86400000);
  const rows = await ClassPresence.findAll({
    where: {
      userId,
      joinedAt: { [Op.between]: [start, end] },
      durationSeconds: { [Op.gte]: minTrialAttendanceSeconds() },
    },
    attributes: ['slotId', 'joinedAt'],
    raw: true,
  });
  const seen = new Set(
    rows.map((r) => `${r.slotId}|${moment(r.joinedAt).tz(PKT).format('YYYY-MM-DD')}`)
  );
  return seen.size;
}

// ── Class picker data ────────────────────────────────────────────────

async function listTrialClasses(userId) {
  const user = await User.findByPk(userId, { attributes: ['id', 'timeZone'] });
  const tz = (user && user.timeZone) || PKT;
  const todayPkt = moment.tz(PKT).startOf('day');

  const slots = await Slot.findAll({
    include: [{ model: User, attributes: ['id', 'firstName', 'lastName', 'image'] }],
  });

  // Popularity: distinct women who joined each class in the last 7 days.
  const since = new Date(Date.now() - 7 * 86400000);
  const pop = await ClassPresence.findAll({
    where: { joinedAt: { [Op.gte]: since } },
    attributes: ['slotId', [fn('COUNT', fn('DISTINCT', col('userId'))), 'n']],
    group: ['slotId'],
    raw: true,
  });
  const popBySlot = new Map(pop.map((p) => [Number(p.slotId), Number(p.n)]));

  const profile = await PreConsultationProfile.findOne({ where: { userId } });
  const ws = asJson(profile && profile.workoutSection, {}) || {};
  const level = String(ws.fitnessLevel || '').toLowerCase();
  const goal = String((profile && profile.goals) || '').toLowerCase();
  const gentleGoal = /pcos|postpartum|pregnancy/.test(goal);
  const picked = Array.isArray(ws.preferredSlotIds)
    ? ws.preferredSlotIds.map(Number)
    : [];

  const classes = [];
  for (const s of slots) {
    const startPkt = slotMomentOn(s.start, todayPkt);
    if (!startPkt || !s.User) continue; // placeholder rows / no trainer
    const endPkt = slotMomentOn(s.end, todayPkt);
    const startLocal = startPkt.clone().tz(tz);
    // Day before / same / after in her time zone vs Pakistan (-1/0/+1).
    const dayShift = moment(startLocal.format('YYYY-MM-DD')).diff(
      moment(startPkt.format('YYYY-MM-DD')),
      'days'
    );
    const type = (s.type || '').trim();
    const slotLevel = String(s.level || '').toLowerCase();
    classes.push({
      slotId: s.id,
      type: type || 'Live class',
      level: s.level || null,
      description: s.description || null,
      startPkt: startPkt.format(SLOT_FORMAT),
      endPkt: endPkt ? endPkt.format(SLOT_FORMAT) : null,
      startLocal: startLocal.format(SLOT_FORMAT),
      endLocal: endPkt ? endPkt.clone().tz(tz).format(SLOT_FORMAT) : null,
      // -1 / 0 / +1: the class falls on the day before / same / after
      // in her time zone compared with Pakistan.
      dayShift,
      part: partOfDay(startLocal.hour()),
      sortKey: startLocal.hour() * 60 + startLocal.minute(),
      trainer: {
        id: s.User.id,
        name: `${s.User.firstName || ''} ${s.User.lastName || ''}`.trim(),
        image: s.User.image || null,
      },
      joinedLastWeek: popBySlot.get(Number(s.id)) || 0,
      picked: picked.includes(Number(s.id)),
      _levelMatch: level && slotLevel.includes(level),
      _gentle: /low|yoga|stretch|beginner/.test(`${slotLevel} ${type.toLowerCase()}`),
    });
  }

  // "Recommended for you": up to 2 classes that fit her level (and a
  // gentler style for PCOS / postpartum / pregnancy goals), most popular
  // first. Falls back to the 2 most popular classes.
  const score = (c) =>
    (c._levelMatch ? 2 : 0) + (gentleGoal && c._gentle ? 1 : 0);
  const ranked = [...classes].sort(
    (a, b) => score(b) - score(a) || b.joinedLastWeek - a.joinedLastWeek
  );
  const recommendedIds = new Set(ranked.slice(0, 2).map((c) => c.slotId));

  const out = classes
    .map(({ _levelMatch, _gentle, ...c }) => ({
      ...c,
      recommended: recommendedIds.has(c.slotId),
    }))
    .sort((a, b) => a.sortKey - b.sortKey);

  return {
    timeZone: tz,
    showsPakistanTime: tz !== PKT,
    joinWindowMinutes: getJoinWindowMinutes(),
    classes: out,
  };
}

// ── Reminders (cron, every 5 minutes) ────────────────────────────────

let _redis = null;
function redis() {
  if (_redis !== null) return _redis;
  try {
    const Redis = require('ioredis');
    _redis = new Redis({
      host: '127.0.0.1',
      port: 6379,
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    _redis.on('error', () => {});
  } catch (e) {
    _redis = false;
  }
  return _redis;
}

/** Once per (user, day, kind), and at most 2 class pushes a day. */
async function claimReminder(userId, dayKey, kind) {
  const r = redis();
  if (!r) return true;
  try {
    const once = await r.set(`trialremind:${userId}:${dayKey}:${kind}`, '1', 'EX', 129600, 'NX');
    if (once !== 'OK') return false;
    const n = await r.incr(`trialremind:${userId}:${dayKey}:count`);
    await r.expire(`trialremind:${userId}:${dayKey}:count`, 129600);
    return n <= 2;
  } catch (e) {
    return true;
  }
}

async function sendTrialClassReminders() {
  const days = getTrialDays();
  const windowMin = getJoinWindowMinutes();
  const nowPkt = moment.tz(PKT);
  const todayPkt = nowPkt.clone().startOf('day');
  const dayKey = todayPkt.format('YYYYMMDD');

  const journeys = await TrialJourney.findAll({
    where: {
      convertedAt: null,
      startedAt: { [Op.gte]: new Date(Date.now() - days * 86400000) },
    },
    attributes: ['userId', 'startedAt'],
  });
  if (journeys.length === 0) return 0;

  let sent = 0;
  for (const j of journeys) {
    try {
      const user = await User.findByPk(j.userId, {
        attributes: ['id', 'deviceToken', 'timeZone', 'status'],
      });
      if (!user || !user.deviceToken || user.status === true) continue;

      const profile = await PreConsultationProfile.findOne({ where: { userId: j.userId } });
      const ws = asJson(profile && profile.workoutSection, {}) || {};
      const picked = Array.isArray(ws.preferredSlotIds) ? ws.preferredSlotIds.map(Number) : [];
      if (picked.length === 0) continue;

      // Already joined a class today: no class reminders needed.
      const joinedToday = await ClassPresence.findOne({
        where: { userId: j.userId, joinedAt: { [Op.gte]: todayPkt.toDate() } },
        attributes: ['id'],
      });
      if (joinedToday) continue;

      const slots = await Slot.findAll({
        where: { id: { [Op.in]: picked } },
        include: [{ model: User, attributes: ['firstName'] }],
      });
      // Her next picked class that she can still join today.
      const upcoming = slots
        .map((s) => ({ s, at: slotMomentOn(s.start, todayPkt) }))
        .filter((x) => x.at && nowPkt.isBefore(x.at.clone().add(windowMin, 'minutes')))
        .sort((a, b) => a.at.valueOf() - b.at.valueOf())[0];
      if (!upcoming) continue;

      const mins = upcoming.at.diff(nowPkt, 'minutes', true);
      const tz = user.timeZone || PKT;
      const local = upcoming.at.clone().tz(tz).format('h:mm A');
      const type = (upcoming.s.type || 'class').trim();
      const trainer = upcoming.s.User && upcoming.s.User.firstName;
      const withTrainer = trainer ? ` with ${trainer}` : '';

      let kind = null;
      let msg = null;
      if (mins <= 15 && mins > 10) {
        kind = 'soon';
        msg = {
          title: `Your ${local} class starts soon`,
          body: `${type}${withTrainer}. Join in the first ${windowMin} minutes for the full warm-up 💪`,
        };
      } else if (mins <= 0 && mins > -5) {
        kind = 'live';
        msg = {
          title: "It's live! 🔔",
          body: `You have ${windowMin} minutes to join ${type}${withTrainer}.`,
        };
      }
      if (!kind) continue;
      if (!(await claimReminder(j.userId, dayKey, kind))) continue;

      await sendNotification([user.deviceToken], msg, {
        type: 'trialClassReminder',
        slotId: String(upcoming.s.id),
        kind,
      });
      sent++;
    } catch (e) {
      console.error('[trialClasses] reminder user', j.userId, e.message);
    }
  }
  return sent;
}

module.exports = {
  countTrialClassesAttended,
  listTrialClasses,
  sendTrialClassReminders,
};
