/**
 * Life stage access rules (signup step 5: "Which of these fits you right now?").
 *
 *   pregnant   -> no access yet, "coming soon" screen. We ask her due
 *                 date; once due date + the normal waiting time has
 *                 passed we push "has your baby arrived?" and send her
 *                 back through step 5 (access 'baby_check').
 *   postpartum -> needs baby's birth date + delivery type. Locked until
 *                 the safe waiting time has passed, then she ticks "my
 *                 doctor has said I can exercise" and gets full access
 *                 (free trial, classes, diet) like every other user.
 *   anything else -> full access.
 *
 * Waiting times come from .env so they can change without an app release:
 *   POSTPARTUM_WAIT_DAYS_NORMAL    (default 42, about 6 weeks)
 *   POSTPARTUM_WAIT_DAYS_CSECTION  (default 90, about 3 months)
 */
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const { PreConsultationProfile, User } = require('../models');
const sendNotification = require('./notification');

const PKT = 'Asia/Karachi';

function envDays(name, fallback) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 && n <= 730 ? n : fallback;
}

function waitDays(deliveryType) {
  return deliveryType === 'c_section'
    ? envDays('POSTPARTUM_WAIT_DAYS_CSECTION', 90)
    : envDays('POSTPARTUM_WAIT_DAYS_NORMAL', 42);
}

/** Due date + normal waiting time: when we ask "has your baby arrived?". */
function babyCheckFrom(dueYmd) {
  return moment
    .tz(dueYmd, 'YYYY-MM-DD', PKT)
    .add(waitDays('normal'), 'days')
    .format('YYYY-MM-DD');
}

/** Date (YYYY-MM-DD) she can join from, or null if we don't know yet. */
function availableFrom(profile) {
  if (!profile || !profile.babyBirthDate || !profile.deliveryType) return null;
  return moment
    .tz(String(profile.babyBirthDate).slice(0, 10), 'YYYY-MM-DD', PKT)
    .add(waitDays(profile.deliveryType), 'days')
    .format('YYYY-MM-DD');
}

/**
 * access:
 *   'full'            normal user, let her in
 *   'pregnant'        coming soon screen
 *   'needs_details'   postpartum, ask birth date + delivery type
 *   'waiting'         postpartum, locked until `availableFrom`
 *   'needs_clearance' postpartum, waiting time over, ask for the doctor tick
 */
function evaluate(profile) {
  const status = (profile && profile.pregnancyMenstrualStatus) || null;
  const base = {
    status,
    babyBirthDate: profile && profile.babyBirthDate ? String(profile.babyBirthDate).slice(0, 10) : null,
    deliveryType: (profile && profile.deliveryType) || null,
    availableFrom: null,
    waitDays: null,
    dueDate: null,
    checkFrom: null,
  };
  if (status === 'pregnant') {
    const due = profile && profile.dueDate ? String(profile.dueDate).slice(0, 10) : null;
    const out = { ...base, dueDate: due };
    if (!due) return { ...out, access: 'pregnant' };
    const checkFrom = babyCheckFrom(due);
    const today = moment.tz(PKT).format('YYYY-MM-DD');
    return { ...out, checkFrom, access: checkFrom <= today ? 'baby_check' : 'pregnant' };
  }
  if (status !== 'postpartum') return { ...base, access: 'full' };

  if (!base.babyBirthDate || !base.deliveryType) {
    return { ...base, access: 'needs_details' };
  }
  const from = availableFrom(profile);
  const today = moment.tz(PKT).format('YYYY-MM-DD');
  const out = { ...base, availableFrom: from, waitDays: waitDays(base.deliveryType) };
  if (from > today) return { ...out, access: 'waiting' };
  if (!profile.exerciseClearedAt) return { ...out, access: 'needs_clearance' };
  return { ...out, access: 'full' };
}

async function getLifeStage(userId) {
  const profile = await PreConsultationProfile.findOne({ where: { userId } });
  return evaluate(profile);
}

const ALLOWED_STATUS = new Set([
  'regular_cycle',
  'irregular_cycle',
  'trying_to_conceive',
  'pregnant',
  'postpartum',
  'menopause',
  'prefer_not_to_say',
]);

/**
 * Save her answer (and postpartum details) and return the new access state.
 * body: { status?, babyBirthDate?, deliveryType?, doctorCleared? }
 */
async function saveLifeStage(userId, body = {}) {
  let profile = await PreConsultationProfile.findOne({ where: { userId } });
  if (!profile) {
    profile = await PreConsultationProfile.create({
      userId,
      stepsCompleted: {},
      dietitianComments: [],
      isComplete: false,
    });
  }
  const updates = {};

  if (body.status !== undefined) {
    if (!ALLOWED_STATUS.has(body.status)) {
      const err = new Error('Unknown option');
      err.userMessage = 'Please pick one of the options.';
      throw err;
    }
    updates.pregnancyMenstrualStatus = body.status;
    if (body.status !== 'pregnant') {
      updates.dueDate = null;
      updates.dueCheckNotifiedAt = null;
    }
    if (body.status !== 'postpartum') {
      updates.babyBirthDate = null;
      updates.deliveryType = null;
      updates.exerciseClearedAt = null;
    }
  }

  if (body.babyBirthDate !== undefined) {
    const d = moment.tz(String(body.babyBirthDate).slice(0, 10), 'YYYY-MM-DD', true, PKT);
    const today = moment.tz(PKT).endOf('day');
    if (!d.isValid() || d.isAfter(today) || d.isBefore(today.clone().subtract(2, 'years'))) {
      const err = new Error('Bad birth date');
      err.userMessage = 'Please pick your baby\'s birth date.';
      throw err;
    }
    updates.babyBirthDate = d.format('YYYY-MM-DD');
  }

  // Pregnant: expected due date ("not sure" sends null).
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === '') {
      updates.dueDate = null;
    } else {
      const d = moment.tz(String(body.dueDate).slice(0, 10), 'YYYY-MM-DD', true, PKT);
      const today = moment.tz(PKT).startOf('day');
      if (!d.isValid() || d.isBefore(today.clone().subtract(1, 'month')) || d.isAfter(today.clone().add(10, 'months'))) {
        const err = new Error('Bad due date');
        err.userMessage = 'Please pick your due date.';
        throw err;
      }
      updates.dueDate = d.format('YYYY-MM-DD');
    }
    updates.dueCheckNotifiedAt = null;
  }

  if (body.deliveryType !== undefined) {
    if (!['normal', 'c_section'].includes(body.deliveryType)) {
      const err = new Error('Bad delivery type');
      err.userMessage = 'Please choose how your baby was delivered.';
      throw err;
    }
    updates.deliveryType = body.deliveryType;
  }

  // Doctor clearance only counts once the waiting time is over.
  if (body.doctorCleared === true) {
    const check = evaluate({ ...profile.get({ plain: true }), ...updates });
    if (check.access === 'needs_clearance' || check.access === 'full') {
      updates.exerciseClearedAt = new Date();
    }
  }

  updates.lastUserUpdate = new Date();
  await profile.update(updates);
  return evaluate(profile);
}

/** Daily: one push to new mothers whose waiting time ended today (or earlier). */
async function sendPostpartumReadyReminders() {
  const rows = await PreConsultationProfile.findAll({
    where: {
      pregnancyMenstrualStatus: 'postpartum',
      babyBirthDate: { [Op.ne]: null },
      deliveryType: { [Op.ne]: null },
      exerciseClearedAt: null,
      postpartumReadyNotifiedAt: null,
    },
  });
  const today = moment.tz(PKT).format('YYYY-MM-DD');
  let sent = 0;
  for (const p of rows) {
    try {
      const from = availableFrom(p);
      if (!from || from > today) continue;
      p.postpartumReadyNotifiedAt = new Date();
      await p.save();
      const user = await User.findByPk(p.userId, { attributes: ['deviceToken'] });
      if (!user || !user.deviceToken) continue;
      await sendNotification(
        [user.deviceToken],
        {
          title: "You're ready to join FitHer 💚",
          body: 'Your waiting time is over. Open the app to start your free trial.',
        },
        { type: 'postpartumReady' }
      );
      sent++;
    } catch (e) {
      console.error('[lifeStage] ready push', p.userId, e.message);
    }
  }
  return sent;
}

/** Daily: one push to mums-to-be whose due date + waiting time has passed. */
async function sendDueDateCheckIns() {
  const rows = await PreConsultationProfile.findAll({
    where: {
      pregnancyMenstrualStatus: 'pregnant',
      dueDate: { [Op.ne]: null },
      dueCheckNotifiedAt: null,
    },
  });
  const today = moment.tz(PKT).format('YYYY-MM-DD');
  let sent = 0;
  for (const p of rows) {
    try {
      if (babyCheckFrom(String(p.dueDate).slice(0, 10)) > today) continue;
      p.dueCheckNotifiedAt = new Date();
      await p.save();
      const user = await User.findByPk(p.userId, { attributes: ['deviceToken'] });
      if (!user || !user.deviceToken) continue;
      await sendNotification(
        [user.deviceToken],
        {
          title: 'Congratulations on your little one 💚',
          body: "When you're ready, tell us about your baby and we'll let you know when you can start.",
        },
        { type: 'dueDateCheckIn' }
      );
      sent++;
    } catch (e) {
      console.error('[lifeStage] due check push', p.userId, e.message);
    }
  }
  return sent;
}

module.exports = {
  sendDueDateCheckIns,
  babyCheckFrom,
  evaluate,
  getLifeStage,
  saveLifeStage,
  availableFrom,
  waitDays,
  sendPostpartumReadyReminders,
};
