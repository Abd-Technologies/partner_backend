'use strict';
/**
 * Free-trial moments (Nov 2026).
 *
 *   progress  Day 3    "Your energy is rising"         push 6 PM
 *   month     Day 4    "Your next month is ready"      push 1 PM   (trials of 5+ days)
 *   lastDay   last day "N days done" + offer           push 11 AM
 *   ended     after    "Your free trial has ended"     push 11 AM the day after (shown for 7 days)
 *   + Day 2 10 AM "See you today" if she missed a class on day 1; on
 *     days 3+ a missed class yesterday changes that day's push instead
 *     (still one trial push a day)
 *   + offer push 6 h before her 20% offer ends
 *
 * Each moment is shown ONCE: the push opens its sheet; not tapped, the app
 * shows it as a pop-up; missed again, a Home card. "Seen" (and "pushed")
 * live on a PendingPopupState row, cycle = her trial journey id. These
 * rows are hidden from the server pop-up list (popupEligibility
 * HIDDEN_POPUPS): the app's TrialMomentController shows them on both Homes.
 *
 * Never for paid women (a real paid plan, not user.status). One trial push
 * a day at most (class reminders not counted). Quiet hours: sendNotification
 * holds pushes until her morning.
 */
const { Op } = require('sequelize');
const moment = require('moment-timezone');

const PKT = 'Asia/Karachi';
const VAR = {
  progress: 'POPUP_TRIAL_DAY3',
  month: 'POPUP_TRIAL_DAY4',
  lastDay: 'POPUP_TRIAL_LASTDAY',
  ended: 'POPUP_TRIAL_ENDED',
};
const KINDS = Object.keys(VAR);
const ENDED_SHOW_DAYS = 7;
const PUSH_UNTIL_HOUR = 20; // no trial pushes after 8 PM her time
const PUSH = {
  progress: { hour: 18 },
  month: { hour: 13 },
  lastDay: { hour: 11 },
  ended: { hour: 11 },
};

const models = () => require('../models');
const tzOf = (u) => (u && u.timeZone && moment.tz.zone(u.timeZone) ? u.timeZone : PKT);
const firstNameOf = (u) => String((u && u.firstName) || '').trim().split(/\s+/)[0] || '';

// ── kcal estimate (shared with class feedback) ─────────────────────────
// MET by class type; kcal/min = MET × 3.5 × kg / 200. An estimate, always
// shown as "about".
const MET = [
  [/zumba|dance|aerobic/i, 6.5],
  [/hiit|high|intens|cardio|power|interval/i, 6],
  [/strength|tone|toning|weight|body/i, 5],
  [/pilates|core/i, 3.5],
  [/yoga|stretch|mobility|gentle|low|recovery/i, 2.5],
];
function metFor(type) {
  const t = String(type || '');
  for (const [re, m] of MET) if (re.test(t)) return m;
  return 4;
}
function kcalFor(minutes, type, weightKg) {
  const kg = Number(weightKg) > 30 && Number(weightKg) < 250 ? Number(weightKg) : 65;
  const k = (metFor(type) * 3.5 * kg) / 200 * Math.max(0, Number(minutes) || 0);
  return Math.round(k / 5) * 5;
}

// One short line per class type: what it does for her body. Trainers can
// rewrite these; a type with no line shows nothing.
const BENEFITS = [
  [/pilates|core/i, 'Good for posture and back ache.'],
  [/zumba|dance|aerobic/i, 'Great for your heart and your mood.'],
  [/yoga|stretch/i, 'Eases stress and stiff muscles.'],
  [/mobility|gentle|recovery/i, 'Helps your body recover and move freely.'],
  [/strength|tone|toning|weight|power/i, 'Builds strength and supports your metabolism.'],
  [/hiit|high|intens|cardio|interval/i, 'Burns energy fast and builds stamina.'],
];
function benefitFor(type) {
  const t = String(type || '');
  for (const [re, line] of BENEFITS) if (re.test(t)) return line;
  return null;
}

// ── Her next class (any member) ─────────────────────────────────────────
/** Her next class that reminds her (her picked times / ids, "once", or all
 *  classes if she never picked), as "today 7:00 PM" / "tomorrow 7:00 PM" /
 *  "Thu 7:00 PM" in her time zone. Null when none in the next 7 days. */
async function nextClassFor(userId) {
  try {
    const { Slot, Time, User, PreConsultationProfile } = models();
    const { isHerClass, normTime, onceToday } = require('./classAudience');
    const { parseEndAsUtc } = require('./timeFormats');
    const user = await User.findByPk(userId, { attributes: ['timeZone'] });
    const tz = tzOf(user);
    const p = await PreConsultationProfile.findOne({ where: { userId }, attributes: ['workoutSection'] });
    let ws = p && p.workoutSection;
    if (typeof ws === 'string') {
      try { ws = JSON.parse(ws); } catch (_) { ws = {}; }
    }
    ws = ws || {};
    const her = {
      picks: (Array.isArray(ws.preferredSlotIds) ? ws.preferredSlotIds : []).map(Number).filter(Number.isFinite),
      times: (Array.isArray(ws.preferredTimes) ? ws.preferredTimes : []).map(normTime).filter(Boolean),
      timeZone: tz,
      once: onceToday(ws),
    };
    const slots = await Slot.findAll({
      where: { trainerId: { [Op.ne]: null } },
      include: [{ model: Time, attributes: ['day'] }],
      attributes: ['id', 'start', 'type', 'status', 'TimeId'],
    });
    const now = moment.utc();
    for (let add = 0; add <= 7; add++) {
      const dayPkt = moment.tz(PKT).add(add, 'days').startOf('day');
      const name = dayPkt.format('dddd');
      const next = slots
        .filter((s) => s.Time && s.Time.day === name && isHerClass(her, s) && !(add === 0 && s.status === 'Cancelled'))
        .map((s) => ({ s, at: parseEndAsUtc(s.start, dayPkt) }))
        .filter((x) => x.at && x.at.isAfter(now))
        .sort((a, b) => a.at.valueOf() - b.at.valueOf())[0];
      if (next) {
        const local = next.at.clone().tz(tz);
        const today = moment.tz(tz).startOf('day');
        const diff = local.clone().startOf('day').diff(today, 'days');
        const when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : local.format('ddd');
        return `${when} ${local.format('h:mm A')}`;
      }
    }
  } catch (e) {
    console.error('[trialMoments] next class', userId, e.message);
  }
  return null;
}

// ── Cycle phase + Luna line ────────────────────────────────────────────
const PHASE = {
  menstrual: { label: 'period', tip: 'Go gently today. Rest and warm, iron-rich food help.' },
  follicular: { label: 'follicular phase', tip: 'You recover fast this week. Have some protein within the hour.' },
  ovulatory: { label: 'ovulation', tip: 'Your energy peaks now. A great time for a harder class.' },
  luteal: { label: 'luteal phase', tip: 'Cravings are normal now. Choose slow carbs and go easy on salt.' },
};
async function phaseOf(userId) {
  try {
    const { UserCycleData } = models();
    const row = await UserCycleData.findOne({ where: { userId } });
    if (!row || !row.lastPeriodDate || row.dataProvided !== 1) return null;
    const info = require('./CyclePhaseCalculator').calculate({
      lastPeriodDate: row.lastPeriodDate,
      averageCycleLength: row.averageCycleLength || 28,
    });
    if (!info || !PHASE[info.phase]) return null;
    return {
      phase: info.phase,
      cycleDay: info.cycleDay,
      label: PHASE[info.phase].label,
      tip: PHASE[info.phase].tip,
      cycleLength: row.averageCycleLength || 28,
    };
  } catch (e) {
    console.error('[trialMoments] phase', userId, e.message);
    return null;
  }
}

// ── Which moment is due ────────────────────────────────────────────────
function trialDayNumber(journey, tz) {
  const start = moment(journey.startedAt).tz(tz).startOf('day');
  const today = moment().tz(tz).startOf('day');
  return today.diff(start, 'days') + 1;
}

/** Her trial context, or null when she has no trial or has paid. */
async function contextFor(userId) {
  const { TrialJourney, User } = models();
  const journey = await TrialJourney.findOne({ where: { userId } });
  if (!journey || !journey.startedAt || journey.convertedAt) return null;
  const { hasRealPaidPlan, trialWindow } = require('./trialOffer');
  if (await hasRealPaidPlan(userId)) return null;
  const user = await User.findByPk(userId, { attributes: ['id', 'firstName', 'timeZone', 'deviceToken', 'weight'] });
  if (!user) return null;
  const tz = tzOf(user);
  const total = require('./trialState').getTrialDays();
  return { userId, journey, user, tz, total, day: trialDayNumber(journey, tz), window: trialWindow(journey) };
}

function kindFor(ctx) {
  const w = ctx.window;
  if (w.ended) {
    const sinceEnd = moment().diff(moment(w.endsAt), 'days', true);
    return sinceEnd <= ENDED_SHOW_DAYS ? 'ended' : null;
  }
  if (ctx.day >= ctx.total || w.lastDay) return 'lastDay';
  if (ctx.total >= 5 && ctx.day === ctx.total - 1) return 'month';
  if (ctx.day === 3) return 'progress';
  return null;
}

// ── Seen / pushed (PendingPopupState, cycle = journey id) ──────────────
async function rowFor(ctx, kind, create = false) {
  const { PendingPopupState } = models();
  const rows = await PendingPopupState.findAll({
    where: { userId: ctx.userId, popupVariable: VAR[kind] },
    order: [['createdAt', 'DESC']],
    limit: 5,
  });
  const cycle = String(ctx.journey.id);
  let row = rows.find((r) => r.metadata && String(r.metadata.cycle) === cycle) || null;
  if (!row && create) {
    row = await PendingPopupState.create({
      userId: ctx.userId,
      popupVariable: VAR[kind],
      eligibleAt: new Date(),
      metadata: { cycle },
    });
  }
  return row;
}
async function isSeen(ctx, kind) {
  const row = await rowFor(ctx, kind);
  return !!(row && row.completedAt);
}
async function markSeen(ctx, kind, via) {
  const row = await rowFor(ctx, kind, true);
  if (row.completedAt) return row;
  await row.update({
    completedAt: new Date(),
    lastShownAt: new Date(),
    metadata: { ...(row.metadata || {}), seenVia: via || 'app' },
  });
  return row;
}

// ── Data for each sheet ────────────────────────────────────────────────
const MOOD = { 1: ['Great', 4], 2: ['Tired', 1], 3: ['Sore', 2], 4: ['Energised', 5], 5: ['Stressed', 2] };

async function common(ctx) {
  const { MealLog, DailyCheckin } = models();
  const startKey = moment(ctx.journey.startedAt).tz(ctx.tz).format('YYYY-MM-DD');
  const [classes, streak, meals, checkins, phase] = await Promise.all([
    require('./trialClasses').countTrialClassesAttended(ctx.userId, ctx.journey).catch(() => 0),
    require('./attendanceStats').streakDays(ctx.userId).catch(() => 0),
    MealLog.count({
      where: { userId: ctx.userId, status: { [Op.in]: ['followed', 'alternative'] }, createdAt: { [Op.gte]: ctx.journey.startedAt } },
    }).catch(() => 0),
    DailyCheckin.findAll({
      where: { userId: ctx.userId, date: { [Op.gte]: startKey } },
      attributes: ['date', 'moodLevel', 'sleepHours'],
      order: [['date', 'ASC']],
      raw: true,
    }).catch(() => []),
    phaseOf(ctx.userId),
  ]);
  const energy = checkins
    .filter((c) => MOOD[c.moodLevel])
    .map((c) => ({ date: String(c.date).slice(0, 10), label: MOOD[c.moodLevel][0], value: MOOD[c.moodLevel][1] }))
    .slice(-5);
  const sleeps = checkins.filter((c) => Number(c.sleepHours) > 0).map((c) => Number(c.sleepHours));
  const sleep = sleeps.length >= 2 ? { first: sleeps[0], latest: sleeps[sleeps.length - 1] } : null;
  return {
    name: firstNameOf(ctx.user),
    trialDays: ctx.total,
    day: Math.min(ctx.day, ctx.total),
    classes,
    classGoal: require('./trialState').getTrialClassGoal(),
    streak,
    meals,
    energy,
    energyUp: energy.length >= 2 && energy[energy.length - 1].value > energy[0].value,
    sleep,
    phase,
  };
}

async function sleptBestAfterClass(ctx) {
  try {
    const { DailyCheckin } = models();
    const startKey = moment(ctx.journey.startedAt).tz(PKT).format('YYYY-MM-DD');
    const rows = await DailyCheckin.findAll({
      where: { userId: ctx.userId, date: { [Op.gte]: startKey }, sleepHours: { [Op.gt]: 0 } },
      attributes: ['date', 'sleepHours'],
      raw: true,
    });
    const classDays = await require('./attendanceStats').attendedDays(ctx.userId, 10);
    // Sleep logged on day D is last night's sleep: it follows a class on D-1.
    const after = [];
    const other = [];
    for (const r of rows) {
      const prev = moment(String(r.date).slice(0, 10)).subtract(1, 'day').format('YYYY-MM-DD');
      (classDays.has(prev) ? after : other).push(Number(r.sleepHours));
    }
    if (!after.length || !other.length) return false;
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return avg(after) - avg(other) >= 0.5;
  } catch (_) {
    return false;
  }
}

async function preferredTime(userId) {
  try {
    const { PreConsultationProfile } = models();
    const p = await PreConsultationProfile.findOne({ where: { userId }, attributes: ['workoutSection', 'goals'] });
    let ws = p && p.workoutSection;
    if (typeof ws === 'string') ws = JSON.parse(ws);
    const t = ws && Array.isArray(ws.preferredTimes) && ws.preferredTimes[0];
    return { time: t ? String(t).trim().replace(/^0/, '') : null, goals: (p && p.goals) || null };
  } catch (_) {
    return { time: null, goals: null };
  }
}

async function sampleDay(userId) {
  try {
    const { DietPlan, DietPlanDay, DietPlanMeal } = models();
    const plan = await DietPlan.findOne({ where: { userId }, order: [['createdAt', 'DESC']] });
    if (!plan) return [];
    const day = await DietPlanDay.findOne({ where: { dietPlanId: plan.id }, order: [['dayNumber', 'ASC']] });
    if (!day) return [];
    const meals = await DietPlanMeal.findAll({ where: { dietPlanDayId: day.id }, order: [['id', 'ASC']], raw: true });
    return meals.slice(0, 4).map((m) => ({ type: m.mealType, food: m.foodName }));
  } catch (_) {
    return [];
  }
}

function phaseBar(phase) {
  const len = (phase && phase.cycleLength) || 28;
  const period = 5;
  const ovulation = 3;
  const follicular = Math.max(3, Math.round(len / 2) - period - 1);
  const luteal = Math.max(5, len - period - follicular - ovulation);
  return [
    { phase: 'menstrual', label: 'Period', days: period },
    { phase: 'follicular', label: 'Follicular', days: follicular },
    { phase: 'ovulatory', label: 'Ovulation', days: ovulation },
    { phase: 'luteal', label: 'Luteal', days: luteal },
  ];
}

async function trialKcal(ctx) {
  try {
    const { ClassPresence, Slot } = models();
    const rows = await ClassPresence.findAll({
      where: { userId: ctx.userId, joinedAt: { [Op.gte]: ctx.journey.startedAt }, leftAt: { [Op.ne]: null } },
      include: [{ model: Slot, as: 'slot', attributes: ['type'], paranoid: false }],
    });
    let total = 0;
    for (const r of rows) total += kcalFor((Number(r.durationSeconds) || 0) / 60, r.slot && r.slot.type, ctx.user.weight);
    return total > 0 ? Math.round(total / 10) * 10 : null;
  } catch (_) {
    return null;
  }
}

async function offerFor(ctx, country) {
  try {
    const s = await require('./trialOffer').getTrialSummary(ctx.userId, country || null, { peek: false });
    const o = s && s.offer;
    if (!o || o.redeemed) return null;
    const items = Array.isArray(o.items) ? o.items : [];
    const recId = (items.find((i) => i.recommended) || items[0] || {}).planId;
    const mine = items.filter((i) => i.planId === recId).sort((a, b) => (b.days || 0) - (a.days || 0));
    const pick = mine.length > 1 ? [mine[0], mine[mine.length - 1]] : mine;
    return {
      percent: o.percent,
      currency: o.currency,
      expiresAt: o.expiresAt,
      expired: o.expired,
      options: pick.map((i) => ({
        planId: i.planId,
        durationId: i.durationId,
        days: i.days,
        title: i.planTitle,
        listPrice: i.listPrice,
        offerPrice: o.expired ? i.listPrice : i.offerPrice,
      })),
    };
  } catch (e) {
    console.error('[trialMoments] offer', ctx.userId, e.message);
    return null;
  }
}

async function dataFor(ctx, kind, country) {
  const base = await common(ctx);
  if (kind === 'progress') {
    const sleptBest = await sleptBestAfterClass(ctx);
    const pref = await preferredTime(ctx.userId);
    return {
      ...base,
      luna: sleptBest
        ? `You slept best after class days.${pref.time ? ` Keep your ${pref.time} time.` : ''}`
        : (base.phase && base.phase.tip) || null,
      nextTime: pref.time,
    };
  }
  if (kind === 'month') {
    const pref = await preferredTime(ctx.userId);
    return {
      ...base,
      phases: phaseBar(base.phase),
      time: pref.time,
      sampleMeals: await sampleDay(ctx.userId),
      luna: 'Gentler classes in your period week, harder ones when your energy peaks.',
    };
  }
  // lastDay / ended
  return { ...base, kcal: await trialKcal(ctx), offer: await offerFor(ctx, country) };
}

/** GET /trial/moment: the moment due now (or the one she tapped). */
async function momentForApp(userId, { kind: wanted, country } = {}) {
  const ctx = await contextFor(userId);
  if (!ctx) return null;
  const due = kindFor(ctx);
  // A push can be tapped a little after its day: open what she tapped.
  const kind = wanted && KINDS.includes(wanted) ? wanted : due;
  if (!kind) return null;
  const seen = await isSeen(ctx, kind);
  if (seen && !wanted) return { kind, seen: true, data: null };
  return { kind, seen, data: await dataFor(ctx, kind, country) };
}

async function markSeenForApp(userId, kind, via) {
  if (!KINDS.includes(kind)) return false;
  const ctx = await contextFor(userId);
  if (!ctx) return false;
  await markSeen(ctx, kind, via);
  return true;
}

// ── Pushes (hourly) ────────────────────────────────────────────────────
let _redis = null;
function redis() {
  if (_redis) return _redis;
  try {
    const Redis = require('ioredis');
    _redis = new Redis();
    _redis.on('error', () => {});
  } catch (_) {
    _redis = null;
  }
  return _redis;
}
const localOnce = new Map();
async function claim(key, ttlSec) {
  try {
    const r = redis();
    if (r) return (await r.set(key, '1', 'EX', ttlSec, 'NX')) === 'OK';
  } catch (_) {}
  const now = Date.now();
  if ((localOnce.get(key) || 0) > now) return false;
  localOnce.set(key, now + ttlSec * 1000);
  return true;
}

/** Did she miss a class yesterday? Only days classes run count (a
 *  weekday with no classes is a rest day, not a miss). */
async function missedYesterday(ctx) {
  if (ctx.day < 2) return false;
  const stats = require('./attendanceStats');
  const y = moment.tz(PKT).subtract(1, 'day');
  if (y.isBefore(moment(ctx.journey.startedAt).tz(PKT).startOf('day'))) return false;
  const weekdays = await stats.classWeekdays();
  if (weekdays && !weekdays.has(y.format('dddd'))) return false;
  const attended = await stats.attendedDays(ctx.userId, 3);
  return !attended.has(y.format('YYYY-MM-DD'));
}

function copyFor(kind, d, { missed = false, time = null } = {}) {
  const name = d.name ? `, ${d.name}` : '';
  const at = time ? ` at ${time}` : '';
  // Missed yesterday's class: the same push, gently about today's class.
  if (missed) {
    switch (kind) {
      case 'progress':
        return { title: `3 days in${name}`, body: `Your next class${at} keeps your energy going.` };
      case 'month':
        return { title: 'Your next month is ready', body: `Join your next class${at} to keep your streak going.` };
      case 'lastDay':
        return { title: `Last day of your trial${name}`, body: `One more class${at} to finish strong. Your plan is saved.` };
      default:
        break;
    }
  }
  switch (kind) {
    case 'progress':
      return d.energyUp
        ? { title: `Your energy is rising${name}`, body: 'See what changed in your first 3 days.' }
        : { title: `3 days in${name}`, body: 'See your progress so far.' };
    case 'month':
      return { title: 'Your next month is ready', body: 'Made from this week: your goal, your classes and your time.' };
    case 'lastDay':
      return { title: `${d.trialDays} days done${name}!`, body: 'Look what you did in your free trial. Your plan is saved.' };
    case 'ended':
      return { title: 'Your plan is saved for you', body: 'Your meal plan, progress and streak are waiting.' };
    default:
      return null;
  }
}

async function sendOne(user, copy, data) {
  const sendNotification = require('./notification');
  await sendNotification([user.deviceToken], copy, data);
}

async function runTrialPushes() {
  const { TrialJourney } = models();
  const days = require('./trialState').getTrialDays();
  const journeys = await TrialJourney.findAll({
    where: {
      convertedAt: null,
      startedAt: { [Op.gte]: new Date(Date.now() - (days + 2) * 86400000) },
    },
    attributes: ['userId'],
  });
  let sent = 0;
  for (const j of journeys) {
    try {
      const ctx = await contextFor(j.userId);
      if (!ctx || !ctx.user.deviceToken) continue;
      const now = moment().tz(ctx.tz);
      const hour = now.hour();
      if (hour >= PUSH_UNTIL_HOUR) continue;
      const today = now.format('YYYYMMDD');
      const dailyKey = `trialpush:${ctx.userId}:${today}`;

      // Day 2, 10 AM: missed a class on day 1.
      if (!ctx.window.ended && ctx.day === 2 && hour >= 10) {
        const day1 = moment(ctx.journey.startedAt).tz(PKT).format('YYYY-MM-DD');
        const attended = await require('./attendanceStats').attendedDays(ctx.userId, 3);
        if (!attended.has(day1) && (await claim(dailyKey, 86400 * 2))) {
          if (await claim(`trialpush:missed:${ctx.userId}:${ctx.journey.id}`, 86400 * 10)) {
            const pref = await preferredTime(ctx.userId);
            const name = firstNameOf(ctx.user);
            await sendOne(
              ctx.user,
              {
                title: `See you today${name ? `, ${name}` : ''}`,
                body: pref.time ? `Your ${pref.time} class is waiting for you.` : 'Your next class is waiting for you.',
              },
              { type: 'trialClassReminder', kind: 'missedClass' }
            );
            sent++;
            continue;
          }
        }
      }

      const kind = kindFor(ctx);
      if (!kind || !PUSH[kind] || hour < PUSH[kind].hour) continue;
      if (kind === 'ended' && moment().diff(moment(ctx.window.endsAt), 'hours', true) > 48) continue;
      const row = await rowFor(ctx, kind, true);
      if (row.completedAt || (row.metadata && row.metadata.pushedAt)) continue;
      if (!(await claim(dailyKey, 86400 * 2))) continue;
      await row.update({ metadata: { ...(row.metadata || {}), pushedAt: new Date().toISOString() } });
      const d = await common(ctx);
      const missed = kind !== 'ended' && (await missedYesterday(ctx).catch(() => false));
      const pref = missed ? await preferredTime(ctx.userId) : { time: null };
      const copy = copyFor(kind, d, { missed, time: pref.time });
      if (!copy) continue;
      await sendOne(ctx.user, copy, { type: 'trialMoment', kind });
      sent++;
    } catch (e) {
      console.error('[trialMoments] push', j.userId, e.message);
    }
  }

  // Her 20% offer: one push about 6 hours before it ends.
  try {
    const { TrialOffer, User } = models();
    const now = new Date();
    const offers = await TrialOffer.findAll({
      where: {
        redeemedAt: null,
        reminderSentAt: null,
        expiresAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + 6 * 3600000) },
      },
    });
    const { hasRealPaidPlan } = require('./trialOffer');
    for (const o of offers) {
      try {
        o.reminderSentAt = new Date();
        await o.save();
        const user = await User.findByPk(o.userId, { attributes: ['deviceToken'] });
        if (!user || !user.deviceToken || (await hasRealPaidPlan(o.userId))) continue;
        await sendOne(
          user,
          { title: `Your ${o.percent}% ends tonight`, body: 'Keep your plan going at the trial price.' },
          { type: 'trialOfferReminder' }
        );
        sent++;
      } catch (e) {
        console.error('[trialMoments] offer push', o.userId, e.message);
      }
    }
  } catch (e) {
    console.error('[trialMoments] offers', e.message);
  }
  return sent;
}

module.exports = {
  VAR,
  momentForApp,
  markSeenForApp,
  runTrialPushes,
  kcalFor,
  benefitFor,
  nextClassFor,
  phaseOf,
};
