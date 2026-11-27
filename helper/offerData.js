'use strict';
/**
 * offerData.js — data for the public campaign offer page (Nov 2026).
 *
 *   loadOffer(key)        the offer from config/offers.json (re-read when the
 *                         file changes, so an admin can edit it without a restart)
 *   offerPackages(offer)  live packages: the app's own price (Prices table) as the
 *                         "was" price + the campaign price from the offer
 *   classTimetable()      the live class timetable (Slots with a trainer)
 *
 * Read-only: nothing here writes to the database.
 */
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { Op } = require('sequelize');
const { fn, col } = require('sequelize');
const {
  Plan, Price, PriceDurations, Countries, Slot, Time, User,
  ClassPresence, ClassFeedback, Testimonial,
} = require('../models');

const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://backend.thefither.com').replace(/\/+$/, '');
/** Stored file path ("public/images/x.jpg", "/images/x.jpg") or full URL → URL. */
function fileUrl(p) {
  const s = String(p || '').trim().replace(/\\/g, '/');
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const rel = s.replace(/^\.?\/+/, '');
  if (/^(before|after)-/i.test(rel.split('/').pop())) return null; // private progress photos, never
  return `${PUBLIC_BASE}/${rel.startsWith('public/') ? rel : `public/${rel}`}`;
}
const { normalizeSlotTime } = require('./normalizeSlotTime');

const PKT = 'Asia/Karachi';
const SLOT_FORMAT = 'hh:mm A';
const CONFIG = path.join(__dirname, '..', 'config', 'offers.json');
const CACHE_MS = 60 * 1000;
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ── Offer config ────────────────────────────────────────────────
let _cfg = { mtime: 0, data: {} };
function readConfig() {
  try {
    const st = fs.statSync(CONFIG);
    if (st.mtimeMs !== _cfg.mtime) {
      _cfg = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(CONFIG, 'utf8')) };
    }
  } catch (e) {
    console.error('[offer] config/offers.json unreadable:', e.message);
  }
  return _cfg.data || {};
}

/** The offer for a key, or null. `ended` = its timer has run out. */
function loadOffer(key) {
  const k = String(key || '').toLowerCase();
  if (!/^[a-z0-9_-]{1,60}$/.test(k) || k.startsWith('_')) return null;
  const o = readConfig()[k];
  if (!o || o.active === false) return null;
  const endsAt = o.endsAt ? new Date(o.endsAt) : null;
  return {
    key: k,
    ...o,
    endsAt: endsAt && !isNaN(endsAt) ? endsAt : null,
    ended: !!(endsAt && !isNaN(endsAt) && endsAt.getTime() <= Date.now()),
  };
}

// ── Packages ────────────────────────────────────────────────────
/** "8000", "8,000", "8000.00", "PKR 8,000" -> 8000. Decimals are rounded, never glued on. */
const toInt = (v) => {
  const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const daysOf = (d) => toInt(String(d || '').match(/\d+/)?.[0]) || 0;

/** Offer price for a package: fixed number or "25%" off the app price. */
function offerPriceFor(offer, months, listPrice) {
  const raw = offer.offers ? offer.offers[String(months)] : undefined;
  if (raw == null || listPrice == null) return null;
  if (typeof raw === 'string' && /%\s*$/.test(raw)) {
    const pct = parseFloat(raw);
    if (!(pct > 0 && pct < 100)) return null;
    return Math.round((listPrice * (1 - pct / 100)) / 10) * 10;
  }
  const n = toInt(raw);
  return n && n > 0 ? n : null;
}

let _pricesCache = { t: 0, rows: null };
async function livePrices() {
  if (_pricesCache.rows && Date.now() - _pricesCache.t < CACHE_MS) return _pricesCache.rows;
  const rows = await Price.findAll({
    attributes: ['id', 'priceAmount', 'durationId', 'planId'],
    include: [
      { model: PriceDurations, as: 'priceDuration', attributes: ['id', 'duration'] },
      { model: Countries, as: 'country', attributes: ['id', 'name', 'code', 'currency'] },
      { model: Plan, as: 'plan', attributes: ['id', 'title', 'shortDescription', 'status'] },
    ],
  });
  _pricesCache = { t: Date.now(), rows };
  return rows;
}

// ── Static mode (config/offers.json → "static") ──────────────────
// Set while the live prices / timetable are not wired up. When
// offer.static.plans exists, nothing here touches the database.
const MONTH_LABEL = (m) => (m === 1 ? '1 Month' : m + ' Months');

function staticPackages(offer) {
  const st = offer.static || {};
  const cur = st.currency || 'PKR';
  return (st.plans || []).filter((p) => p && Array.isArray(p.packages) && p.packages.length).map((p, i) => ({
    planId: p.id || `s${i + 1}`,
    title: p.title || 'Fit Her plan',
    description: p.description || '',
    currency: p.currency || cur,
    packages: p.packages.map((x) => {
      const months = toInt(x.months) || 1;
      const listPrice = toInt(x.was);
      // "now" wins; without it the offer's own per-length price/percent applies.
      let offerPrice = x.now == null ? offerPriceFor(offer, months, listPrice) : toInt(x.now);
      if (offer.ended || !listPrice || offerPrice == null || offerPrice >= listPrice) offerPrice = null;
      const pay = offerPrice != null ? offerPrice : listPrice;
      return {
        months,
        label: x.label || MONTH_LABEL(months),
        priceDurationId: x.priceDurationId || null,
        listPrice, offerPrice, pay,
        save: offerPrice != null ? listPrice - offerPrice : 0,
        savePct: offerPrice != null ? Math.round(((listPrice - offerPrice) / listPrice) * 100) : 0,
        perMonth: Math.round(pay / months),
      };
    }).filter((x) => x.listPrice).sort((a, b) => a.months - b.months),
  })).filter((p) => p.packages.length);
}

/** Static timetable: classes as typed in the config, grouped by time of day. */
function staticTimetable(offer) {
  const st = offer.static || {};
  const classes = (st.classes || []).map((c) => {
    const t = moment.tz(normalizeSlotTime(c.time), SLOT_FORMAT, true, PKT);
    const mins = t.isValid() ? t.hour() * 60 + t.minute() : 0;
    return {
      time: t.isValid() ? t.format(SLOT_FORMAT) : String(c.time || ''),
      sortKey: mins,
      part: partOfDay(Math.floor(mins / 60)),
      type: c.type || 'Live class',
      level: c.level || null,
      trainer: c.trainer || null,
      trainerImage: c.trainerImage ? fileUrl(c.trainerImage) : trainerPhoto(st, c.trainer),
      bestFor: c.bestFor || null,
      days: c.days || '',
      staticDays: true,
    };
  }).sort((a, b) => a.sortKey - b.sortKey);
  const trainers = (st.trainers || []).map((t) =>
    (typeof t === 'string' ? { name: t, image: null } : { name: t.name, image: fileUrl(t.image) }));
  return {
    classes,
    trainers,
    total: classes.length,
    perDay: toInt(st.classesPerDay) || classes.length,
  };
}
function trainerPhoto(st, name) {
  const t = (st.trainers || []).find((x) => x && typeof x === 'object' && x.name === name);
  return t ? fileUrl(t.image) : null;
}

/** Numbers typed into config.stats. Anything left null is read live instead. */
function staticProof(offer) {
  const s = (offer.static && offer.static.stats) || {};
  const n = (v) => (toInt(v) || null);
  return {
    womenThisWeek: n(s.womenThisWeek),
    ratingAvg: s.rating ? Math.round(Number(s.rating) * 10) / 10 : null,
    ratingCount: n(s.ratingCount),
    membersJoined: n(s.membersJoined),
    results: [],
  };
}
/**
 * Social proof for the hero. Static mode still shows REAL numbers: a value
 * typed in config.stats wins, anything left null is read from the database,
 * and if that read fails the line is simply left out (never invented).
 */
async function proof(offer) {
  const typed = isStatic(offer) ? staticProof(offer) : null;
  if (typed && typed.womenThisWeek != null && typed.ratingAvg != null) return typed;
  let live = { womenThisWeek: null, ratingAvg: null, ratingCount: null, membersJoined: null, results: [] };
  try {
    live = await liveProof();
  } catch (e) {
    console.error('[offer] live proof unavailable:', e.message);
  }
  if (!typed) return live;
  const ratingTyped = typed.ratingAvg != null;
  return {
    womenThisWeek: typed.womenThisWeek != null ? typed.womenThisWeek : live.womenThisWeek,
    ratingAvg: ratingTyped ? typed.ratingAvg : live.ratingAvg,
    ratingCount: ratingTyped ? typed.ratingCount : live.ratingCount,
    membersJoined: typed.membersJoined != null ? typed.membersJoined : live.membersJoined,
    results: live.results,
  };
}

const isStatic = (offer) => !!(offer && offer.static && Array.isArray(offer.static.plans) && offer.static.plans.length);

/**
 * [{ planId, title, description, currency, packages: [{ months, label,
 *    listPrice, offerPrice, save, savePct, perMonth, priceDurationId }] }]
 * Only package lengths named in the offer are shown. After the offer ends,
 * offerPrice is null (normal prices).
 */
async function offerPackages(offer) {
  if (isStatic(offer)) return staticPackages(offer);
  const rows = await livePrices();
  const want = String(offer.country || 'Pakistan').toLowerCase();
  const onlyPlans = Array.isArray(offer.planIds) && offer.planIds.length ? offer.planIds.map(Number) : null;
  const lengths = new Set(Object.keys(offer.offers || {}).map(String));
  const byPlan = new Map();

  for (const r of rows) {
    const plan = r.plan, c = r.country, d = r.priceDuration;
    if (!plan || !c || !d) continue;
    if (plan.status === false || plan.status === 0) continue;
    if (onlyPlans && !onlyPlans.includes(Number(plan.id))) continue;
    if (![c.name, c.code].some((x) => String(x || '').toLowerCase() === want)) continue;
    const days = daysOf(d.duration);
    const months = Math.round(days / 30);
    if (!months || !lengths.has(String(months))) continue;
    const listPrice = toInt(r.priceAmount);
    if (!listPrice) continue;

    let offerPrice = offer.ended ? null : offerPriceFor(offer, months, listPrice);
    if (offerPrice != null && offerPrice >= listPrice) offerPrice = null; // not a discount
    const pay = offerPrice != null ? offerPrice : listPrice;

    if (!byPlan.has(plan.id)) {
      byPlan.set(plan.id, {
        planId: plan.id,
        title: plan.title || 'Fit Her plan',
        description: plan.shortDescription || '',
        currency: c.currency || 'PKR',
        packages: [],
      });
    }
    const p = byPlan.get(plan.id);
    if (p.packages.some((x) => x.months === months)) continue; // one price per length
    p.packages.push({
      months,
      label: months === 1 ? '1 Month' : `${months} Months`,
      priceDurationId: d.id,
      listPrice,
      offerPrice,
      pay,
      save: offerPrice != null ? listPrice - offerPrice : 0,
      savePct: offerPrice != null ? Math.round(((listPrice - offerPrice) / listPrice) * 100) : 0,
      perMonth: Math.round(pay / months),
    });
  }
  const plans = [...byPlan.values()].filter((p) => p.packages.length);
  plans.forEach((p) => p.packages.sort((a, b) => a.months - b.months));
  // Plans with a real discount first, then by title.
  plans.sort((a, b) => (Math.max(0, ...b.packages.map((x) => x.save)) - Math.max(0, ...a.packages.map((x) => x.save))) || String(a.title).localeCompare(String(b.title)));
  return plans;
}

// ── Class timetable ─────────────────────────────────────────────
function partOfDay(h) {
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  return 'Evening';
}

let _ttCache = { t: 0, data: null };
/**
 * { classes: [{ time, sortKey, part, type, level, trainer, days[] }],
 *   perDay: max classes on one day, total: distinct times }
 */
async function classTimetable(offer) {
  if (isStatic(offer)) return staticTimetable(offer);
  if (_ttCache.data && Date.now() - _ttCache.t < CACHE_MS) return _ttCache.data;
  const slots = await Slot.findAll({
    where: { trainerId: { [Op.ne]: null } },
    attributes: ['id', 'start', 'end', 'type', 'level', 'trainerId'],
    include: [
      { model: Time, attributes: ['day'], required: false },
      { model: User, attributes: ['id', 'firstName', 'image'], required: false },
    ],
  });
  const trainers = new Map();
  const map = new Map();
  const perDayCount = new Map();
  for (const s of slots) {
    const t = moment.tz(normalizeSlotTime(s.start), SLOT_FORMAT, true, PKT);
    if (!t.isValid()) continue;
    const type = String(s.type || 'Live class').trim() || 'Live class';
    const key = `${t.format('HH:mm')}|${type.toLowerCase()}`;
    const day = s.Time && s.Time.day ? String(s.Time.day) : null;
    if (!map.has(key)) {
      map.set(key, {
        time: t.format('h:mm A'),
        sortKey: t.hour() * 60 + t.minute(),
        part: partOfDay(t.hour()),
        type,
        level: s.level ? String(s.level).trim() : null,
        trainer: s.User && s.User.firstName ? String(s.User.firstName).trim() : null,
        trainerImage: s.User ? fileUrl(s.User.image) : null,
        days: new Set(),
      });
    }
    if (s.User && s.User.firstName && !trainers.has(s.User.id)) {
      trainers.set(s.User.id, { name: String(s.User.firstName).trim(), image: fileUrl(s.User.image) });
    }
    if (day) {
      map.get(key).days.add(day);
      perDayCount.set(day, (perDayCount.get(day) || 0) + 1);
    }
  }
  const classes = [...map.values()]
    .map((c) => ({ ...c, days: WEEK.filter((d) => c.days.has(d)) }))
    .sort((a, b) => a.sortKey - b.sortKey);
  const data = {
    classes,
    trainers: [...trainers.values()],
    total: new Set(classes.map((c) => c.sortKey)).size,
    perDay: Math.max(0, ...perDayCount.values()) || new Set(classes.map((c) => c.sortKey)).size,
  };
  _ttCache = { t: Date.now(), data };
  return data;
}

// ── Proof: real numbers only ────────────────────────────────────
let _proofCache = { t: 0, data: null };
/**
 * { womenThisWeek, ratingAvg, ratingCount, results: [imageUrl] }
 * Each part is null/empty when the table is missing or the number is too
 * small to be worth showing; the page then leaves that line out.
 */
async function liveProof() {
  if (_proofCache.data && Date.now() - _proofCache.t < 5 * CACHE_MS) return _proofCache.data;
  const since7 = new Date(Date.now() - 7 * 86400000);
  const since90 = new Date(Date.now() - 90 * 86400000);
  const out = { womenThisWeek: null, ratingAvg: null, ratingCount: null, membersJoined: null, results: [] };
  try {
    const n = await ClassPresence.count({ where: { joinedAt: { [Op.gte]: since7 } }, distinct: true, col: 'userId' });
    if (n >= 20) out.womenThisWeek = n;
  } catch (e) { console.error('[offer] proof women:', e.message); }
  try {
    const [r] = await ClassFeedback.findAll({
      where: { rating: { [Op.ne]: null }, skipped: false, classDate: { [Op.gte]: moment(since90).format('YYYY-MM-DD') } },
      attributes: [[fn('AVG', col('rating')), 'avg'], [fn('COUNT', col('id')), 'n']],
      raw: true,
    });
    const avg = r ? Number(r.avg) : 0, cnt = r ? Number(r.n) : 0;
    if (cnt >= 30 && avg >= 4) { out.ratingAvg = Math.round(avg * 10) / 10; out.ratingCount = cnt; }
  } catch (e) { console.error('[offer] proof rating:', e.message); }
  try {
    const rows = await Testimonial.findAll({ where: { status: true }, attributes: ['id', 'image'], order: [['id', 'DESC']], limit: 8 });
    out.results = rows.map((t) => fileUrl(t.image)).filter(Boolean);
  } catch (e) { console.error('[offer] proof results:', e.message); }
  _proofCache = { t: Date.now(), data: out };
  return out;
}

/** The next class from now (Pakistan time): { when: 'Today'|'Tomorrow'|weekday, time, type, trainer, trainerImage } */
function nextClass(classes, now = new Date()) {
  if (!classes || !classes.length) return null;
  const pk = moment(now).tz(PKT);
  for (let add = 0; add < 7; add++) {
    const d = pk.clone().add(add, 'days');
    const wd = d.format('dddd');
    const mins = add === 0 ? pk.hour() * 60 + pk.minute() : -1;
    const c = classes.find((x) => x.sortKey > mins && (x.staticDays || !x.days.length || x.days.includes(wd)));
    if (c) return { when: add === 0 ? 'Today' : add === 1 ? 'Tomorrow' : wd, time: c.time, type: c.type, trainer: c.trainer, trainerImage: c.trainerImage };
  }
  return null;
}

/** "Mon–Sat", "Mon, Wed, Fri", "Every day", or "" */
function daysLabel(days) {
  if (typeof days === 'string') return days; // static config: already written out
  if (!days || !days.length) return '';
  if (days.length === 7) return 'Every day';
  const idx = days.map((d) => WEEK.indexOf(d)).sort((a, b) => a - b);
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  const short = (i) => WEEK[i].slice(0, 3);
  if (consecutive && idx.length >= 3) return `${short(idx[0])}–${short(idx[idx.length - 1])}`;
  return idx.map(short).join(', ');
}

module.exports = { loadOffer, offerPackages, classTimetable, daysLabel, offerPriceFor, proof, nextClass, fileUrl, isStatic };
