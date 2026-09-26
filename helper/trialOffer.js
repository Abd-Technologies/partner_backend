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
} = require('../models');
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
  if (!plan) return false;
  if (plan.planType) return plan.planType === 'combined';
  const t = (plan.title || '').toLowerCase();
  return t.includes('both') || t.includes('combined');
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
 * Summary for GET /trial/summary. Creates the offer on the last day /
 * after the trial if it doesn't exist yet.
 */
async function getTrialSummary(userId, countryName) {
  const journey = await TrialJourney.findOne({ where: { userId } });
  if (!journey || !journey.startedAt) return null;

  const days = getTrialDays();
  const goal = journey.classGoal || getTrialClassGoal();
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
  const eligible = (w.lastDay || w.ended) && !journey.convertedAt && !(user && user.status === true);
  if (!offer && eligible) {
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
    offerOut = {
      percent: offer.percent,
      currency: offer.currency,
      country: offer.country,
      expiresAt: offer.expiresAt,
      expired: new Date(offer.expiresAt) <= new Date(),
      redeemed: !!offer.redeemedAt,
      items,
    };
  }

  return {
    firstName: (user && user.firstName) || null,
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

/** Hourly: one reminder when about a day is left on an unused offer. */
async function sendTrialOfferReminders() {
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
      const user = await User.findByPk(o.userId, { attributes: ['deviceToken', 'status'] });
      o.reminderSentAt = new Date();
      await o.save();
      if (!user || !user.deviceToken || user.status === true) continue;
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

module.exports = {
  getTrialSummary,
  applyOfferToSlip,
  sendTrialOfferReminders,
  getOfferPercent,
  getOfferHours,
};
