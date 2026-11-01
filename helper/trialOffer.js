'use strict';
/**
 * End-of-trial summary + offer.
 *
 * .env:
 *   TRIAL_OFFER_PERCENT  discount, default 20 (1..90)
 *   TRIAL_OFFER_HOURS    how long the offer lasts, default 48
 *
 * The offer is created the first time she opens her summary on her last
 * trial day (or after it ended), priced from HER country's Price rows
 * (same lookup as the plans list: country name from the app, falling
 * back to the default prices), rounded to clean numbers, and frozen in
 * TrialOffers so the countdown is the same everywhere.
 */
const { Op } = require('sequelize');
const moment = require('moment-timezone');
const {
  TrialJourney,
  TrialOffer,
  MealLog,
  Price,
  PriceDurations,
  Countries,
  Plan,
  User,
  PreConsultationProfile,
  ClassPresence,
  WaterLog,
  DailyCheckin,
} = require('../models');
const { minTrialAttendanceSeconds } = require('./trialAttendance');
const { getTrialDays, getTrialClassGoal } = require('./trialState');
const { countTrialClassesAttended } = require('./trialClasses');
const { TRIAL_PLAN_TITLE } = require('../services/trialPlanService');
const sendNotification = require('./notification');

function getOfferPercent() {
  const n = parseInt(process.env.TRIAL_OFFER_PERCENT, 10);
  if (!Number.isInteger(n)) return 20;
  return Math.min(Math.max(n, 1), 90);
}

function getOfferHours() {
  const n = parseInt(process.env.TRIAL_OFFER_HOURS, 10);
  if (!Number.isInteger(n) || n < 1) return 48;
  return Math.min(n, 24 * 14);
}

/** Clean numbers: 6,387 -> 6,400 ; 159.2 -> 159 ; 38.6 -> 39 */
function roundPrice(v) {
  const step = v >= 2000 ? 100 : v >= 200 ? 10 : 1;
  return Math.max(step, Math.round(v / step) * step);
}

async function countryPrices(countryName) {
  const base = (whereCountry, wherePrice) =>
    Price.findAll({
      where: wherePrice,
      include: [
        { model: PriceDurations, as: 'priceDuration' },
        {
          model: Countries,
          as: 'country',
          attributes: ['id', 'name', 'code', 'currency'],
          ...(whereCountry ? { where: whereCountry } : {}),
        },
        {
          model: Plan,
          as: 'plan',
          where: { title: { [Op.notIn]: ['Free Trial', TRIAL_PLAN_TITLE] } },
        },
      ],
    });
  let rows = countryName ? await base({ name: countryName }, undefined) : [];
  if (rows.length === 0) rows = await base(null, { isDefault: true });
  return rows;
}

function isCombined(plan) {
  // planType, then category, then title (helper/planKind.js).
  return require('./planKind').planTypeOf(plan) === 'combined';
}

async function buildOfferItems(userId, countryName) {
  const rows = await countryPrices(countryName);
  if (rows.length === 0) return null;
  const pct = getOfferPercent();

  // Recommend the full package (workout + diet) when there is one.
  const combined = rows.find((r) => isCombined(r.plan));
  const recommendedPlanId = (combined || rows[0]).plan.id;

  const items = rows
    .filter((r) => r.priceDuration && Number(r.priceAmount) > 0)
    .map((r) => {
      const list = Number(r.priceAmount);
      return {
        planId: r.plan.id,
        planTitle: r.plan.title,
        planDescription: r.plan.shortDescription || null,
        durationId: r.priceDuration.id,
        days: Number(r.priceDuration.duration) || null,
        listPrice: list,
        offerPrice: roundPrice(list * (1 - pct / 100)),
        recommended: r.plan.id === recommendedPlanId,
      };
    })
    .sort((a, b) =>
      (b.recommended - a.recommended) || a.planId - b.planId || (a.days || 0) - (b.days || 0)
    );
  const country = rows[0].country || {};
  return { items, currency: country.currency || null, country: country.name || countryName };
}

function trialWindow(journey) {
  const start = moment(journey.startedAt);
  const end = start.clone().add(getTrialDays(), 'days');
  const now = moment();
  return {
    endsAt: end.toDate(),
    ended: now.isSameOrAfter(end),
    lastDay: now.isSameOrAfter(end.clone().subtract(24, 'hours')),
  };
}

function buildNote({ attended, goal, mealsLogged, days, goalKey }) {
  const parts = [];
  if (attended >= goal) {
    parts.push('You reached your class goal. That kind of consistency is exactly how results begin 🌟');
  } else if (attended > 0) {
    parts.push(`You joined ${attended} live class${attended === 1 ? '' : 'es'}. Keep that rhythm going.`);
  } else {
    parts.push('Your plan is ready for you whenever you are. One class is all it takes to start.');
  }
  if (mealsLogged >= days * 2) {
    parts.push(`You logged ${mealsLogged} meals, a great habit to keep.`);
  } else if (mealsLogged > 0) {
    parts.push('Next step: log your meals every day so your plan can do its work.');
  }
  if (/pcos/.test(goalKey)) {
    parts.push('For PCOS, steady meals and regular movement every week make the biggest difference.');
  }
  return parts.slice(0, 2).join(' ');
}

/**
 * Her trial, day by day (Oct 2026, "last day" recap on home + summary).
 *
 * Days are CALENDAR days in her time zone, numbered from the day she
 * started, exactly like her starter meal plan ("Day 3 of 3, Mon"). There
 * are always getTrialDays() of them (the admin's trial length), so a day
 * is never split or mixed with the next one. Activity on a day after the
 * last trial day is not counted.
 *
 * Each day: { day, date, isToday, isFuture, classes, meals, waterMl,
 *             sleepHours, moodLevel }
 */
async function buildTrialDays(userId, journey) {
  const n = getTrialDays();
  const user = await User.findByPk(userId, { attributes: ['timeZone'] });
  let tz = (user && user.timeZone) || 'Asia/Karachi';
  if (!moment.tz.zone(tz)) tz = 'Asia/Karachi';
  const first = moment(journey.startedAt).tz(tz).startOf('day');
  const today = moment().tz(tz).format('YYYY-MM-DD');
  const dates = [];
  for (let i = 0; i < n; i++) dates.push(first.clone().add(i, 'days').format('YYYY-MM-DD'));
  const from = first.toDate();
  const to = first.clone().add(n, 'days').toDate();

  const [presence, meals, water, checkins] = await Promise.all([
    ClassPresence.findAll({
      where: { userId, joinedAt: { [Op.gte]: from, [Op.lt]: to } },
      attributes: ['slotId', 'joinedAt', 'durationSeconds'],
      raw: true,
    }),
    MealLog.findAll({
      where: { userId, date: { [Op.in]: dates }, status: { [Op.in]: ['followed', 'alternative'] } },
      attributes: ['date'],
      raw: true,
    }),
    WaterLog.findAll({
      where: { userId, date: { [Op.in]: dates } },
      attributes: ['date', 'amountMl'],
      raw: true,
    }),
    DailyCheckin.findAll({
      where: { userId, date: { [Op.in]: dates } },
      attributes: ['date', 'sleepHours', 'moodLevel'],
      raw: true,
    }),
  ]);

  const dayKey = (d) => (typeof d === 'string' ? d.slice(0, 10) : moment(d).format('YYYY-MM-DD'));
  // Classes: same rule as the class goal (time in one class on one day
  // adds up across rejoins; counts once it reaches the minimum).
  const perClass = new Map();
  for (const r of presence) {
    const date = moment(r.joinedAt).tz(tz).format('YYYY-MM-DD');
    const key = `${r.slotId}|${date}`;
    perClass.set(key, (perClass.get(key) || 0) + (Number(r.durationSeconds) || 0));
  }
  const min = minTrialAttendanceSeconds();
  const classes = {};
  for (const [key, secs] of perClass) {
    if (secs < min) continue;
    const date = key.split('|')[1];
    classes[date] = (classes[date] || 0) + 1;
  }
  const mealsBy = {};
  for (const r of meals) mealsBy[dayKey(r.date)] = (mealsBy[dayKey(r.date)] || 0) + 1;
  const waterBy = {};
  for (const r of water) waterBy[dayKey(r.date)] = (waterBy[dayKey(r.date)] || 0) + (Number(r.amountMl) || 0);
  const checkBy = {};
  for (const r of checkins) checkBy[dayKey(r.date)] = r;

  return dates.map((date, i) => ({
    day: i + 1,
    date,
    isToday: date === today,
    isFuture: date > today,
    classes: classes[date] || 0,
    meals: mealsBy[date] || 0,
    waterMl: waterBy[date] || 0,
    sleepHours: checkBy[date] && checkBy[date].sleepHours != null ? Number(checkBy[date].sleepHours) : null,
    moodLevel: checkBy[date] && checkBy[date].moodLevel != null ? Number(checkBy[date].moodLevel) : null,
  }));
}

/**
 * Summary for GET /trial/summary. Creates the offer on the last day /
 * after the trial if it doesn't exist yet.
 */
async function getTrialSummary(userId, countryName, { peek = false } = {}) {
  const journey = await TrialJourney.findOne({ where: { userId } });
  if (!journey || !journey.startedAt) return null;

  const days = getTrialDays();
  const goal = getTrialClassGoal() /* always the current rule, even for trials that saved an older goal */;
  const attended = await countTrialClassesAttended(userId, journey);
  const w = trialWindow(journey);
  const mealsLogged = await MealLog.count({
    where: {
      userId,
      status: { [Op.in]: ['followed', 'alternative'] },
      createdAt: { [Op.gte]: journey.startedAt, [Op.lte]: w.endsAt },
    },
  });
  const profile = await PreConsultationProfile.findOne({
    where: { userId },
    attributes: ['goals'],
  });
  const user = await User.findByPk(userId, { attributes: ['firstName', 'status'] });

  let offer = await TrialOffer.findOne({ where: { userId } });
  // Nov 2026: "paid" = a real paid plan, not user.status (a running trial
  // turns status on too, so trial women never got their offer).
  const paid = !!journey.convertedAt || (await hasRealPaidPlan(userId));
  const eligible = (w.lastDay || w.ended) && !paid;
  // peek: the home recap card only reads; the offer (and its countdown)
  // starts when she opens her summary.
  if (!offer && eligible && !peek) {
    const built = await buildOfferItems(userId, countryName);
    if (built && built.items.length) {
      offer = await TrialOffer.create({
        userId,
        percent: getOfferPercent(),
        country: built.country,
        currency: built.currency,
        items: built.items,
        expiresAt: new Date(Date.now() + getOfferHours() * 3600000),
      });
    }
  }

  let offerOut = null;
  if (offer) {
    const items = typeof offer.items === 'string' ? JSON.parse(offer.items) : offer.items;
    const expired = new Date(offer.expiresAt) <= new Date();
    // Offer over: show her REAL prices for her country (today's prices
    // from the admin's country price list, no discount).
    let regularItems = null;
    if (expired && !offer.redeemedAt) {
      try {
        const built = await buildOfferItems(userId, offer.country || countryName);
        if (built) regularItems = built.items.map((i) => ({ ...i, offerPrice: i.listPrice }));
      } catch (e) {
        console.error('[trialOffer] regular prices', userId, e.message);
      }
    }
    offerOut = {
      regularItems,
      percent: offer.percent,
      currency: offer.currency,
      country: offer.country,
      expiresAt: offer.expiresAt,
      expired: new Date(offer.expiresAt) <= new Date(),
      redeemed: !!offer.redeemedAt,
      items,
    };
  }

  let dayList = [];
  try {
    dayList = await buildTrialDays(userId, journey);
  } catch (e) {
    console.error('[trialOffer] days', userId, e.message);
  }

  return {
    firstName: (user && user.firstName) || null,
    converted: paid,
    days: dayList,
    trialDays: days,
    endsAt: w.endsAt,
    lastDay: w.lastDay,
    ended: w.ended,
    classGoal: goal,
    classesAttended: attended,
    mealsLogged,
    note: buildNote({
      attended,
      goal,
      mealsLogged,
      days,
      goalKey: String((profile && profile.goals) || '').toLowerCase(),
    }),
    offer: offerOut,
  };
}

/**
 * Called when a payment slip is uploaded. If she has a live offer that
 * matches this plan + duration + amount, record the discount on the slip
 * and mark the offer redeemed. Returns the matched item or null.
 */
async function applyOfferToSlip({ userId, planId, durationId, price, planImage }) {
  const offer = await TrialOffer.findOne({ where: { userId, redeemedAt: null } });
  if (!offer || new Date(offer.expiresAt) <= new Date()) return null;
  const items = typeof offer.items === 'string' ? JSON.parse(offer.items) : offer.items;
  const item = (items || []).find(
    (i) =>
      Number(i.planId) === Number(planId) &&
      Number(i.durationId) === Number(durationId) &&
      Number(i.offerPrice) === Number(price)
  );
  if (!item) return null;
  if (planImage) {
    planImage.listPrice = item.listPrice;
    planImage.discountAmount = item.listPrice - item.offerPrice;
    planImage.discountReason = `Trial offer ${offer.percent}%`;
  }
  offer.redeemedAt = new Date();
  offer.redeemedPlanImageId = planImage ? planImage.id || null : null;
  await offer.save();
  return item;
}

/**
 * Has a real paid package right now (not the free trial / system trial plan)?
 * Nov 2026: trial pushes used `user.status === true` to mean "paid", but
 * starting a free trial also turns status on (assignFreePlan), so most
 * trial women were skipped. This asks the real question instead (same
 * rule as trialController's "she paid" check).
 */
async function hasRealPaidPlan(userId) {
  const { UserPlan } = require('../models');
  const { activeUserPlanWhere } = require('./activePackage');
  const row = await UserPlan.findOne({
    where: { userId, ...activeUserPlanWhere(), isTrial: { [Op.not]: true } },
    include: [{ model: Plan, attributes: [], where: { title: { [Op.notIn]: ['Free Trial', TRIAL_PLAN_TITLE] } } }],
    attributes: ['id'],
  });
  return !!row;
}

/** Hourly: one reminder when about a day is left on an unused offer. */
async function sendTrialOfferReminders() {
  // Switched off (Oct 2026, founder's call): no "offer ends in N hours"
  // push. The offer itself still shows in the app until it ends.
  // Remove this line to switch it back on.
  if (process.env.TRIAL_OFFER_REMINDER !== 'on') return 0;
  const now = new Date();
  const offers = await TrialOffer.findAll({
    where: {
      redeemedAt: null,
      reminderSentAt: null,
      expiresAt: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + 24 * 3600000) },
    },
  });
  let sent = 0;
  for (const o of offers) {
    try {
      const user = await User.findByPk(o.userId, { attributes: ['deviceToken'] });
      o.reminderSentAt = new Date();
      await o.save();
      if (!user || !user.deviceToken) continue;
      if (await hasRealPaidPlan(o.userId)) continue; // she already bought a plan
      const hours = Math.max(1, Math.round((new Date(o.expiresAt) - now) / 3600000));
      await sendNotification(
        [user.deviceToken],
        {
          title: `Your ${o.percent}% offer ends in ${hours} hours 💚`,
          body: 'Your plan and progress are saved. Continue your journey with Fit Her at the special price.',
        },
        { type: 'trialOfferReminder' }
      );
      sent++;
    } catch (e) {
      console.error('[trialOffer] reminder', o.userId, e.message);
    }
  }
  return sent;
}

/**
 * Hourly: one push on her last trial day, "look what you did". Only
 * trial women who haven't upgraded, 10:00 to 20:00 Pakistan time, once.
 */
async function sendTrialLastDayPushes() {
  const hour = moment().tz('Asia/Karachi').hour();
  if (hour < 10 || hour >= 20) return 0;
  const Redis = require('ioredis');
  const redis = new Redis();
  let sent = 0;
  try {
    const days = getTrialDays();
    const now = Date.now();
    // Started between N days and N-1 days ago = in her last 24 hours.
    const journeys = await TrialJourney.findAll({
      where: {
        convertedAt: null,
        startedAt: {
          [Op.gt]: new Date(now - days * 86400000),
          [Op.lte]: new Date(now - (days - 1) * 86400000),
        },
      },
      attributes: ['userId', 'startedAt'],
    });
    for (const j of journeys) {
      try {
        const user = await User.findByPk(j.userId, { attributes: ['deviceToken'] });
        if (!user || !user.deviceToken) continue;
        // Paid women never get it; trial women do (status alone can't tell them apart).
        if (await hasRealPaidPlan(j.userId)) continue;
        const ok = await redis.set(`triallastday:${j.userId}`, '1', 'EX', 60 * 60 * 24 * 30, 'NX');
        if (ok !== 'OK') continue;
        await sendNotification(
          [user.deviceToken],
          {
            title: 'Last day of your free trial 🌱',
            body: `Look what you did in ${days} day${days === 1 ? '' : 's'}. Your plan and progress are saved.`,
          },
          { type: 'trialLastDay' }
        );
        sent++;
      } catch (e) {
        console.error('[trialOffer] last-day push', j.userId, e.message);
      }
    }
  } finally {
    redis.disconnect();
  }
  return sent;
}

module.exports = {
  hasRealPaidPlan,
  trialWindow,
  getTrialSummary,
  sendTrialLastDayPushes,
  applyOfferToSlip,
  sendTrialOfferReminders,
  getOfferPercent,
  getOfferHours,
};
