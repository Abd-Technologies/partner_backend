// Growth dashboard (admin app › Growth). Exact facts from our database,
// with names, so the team can act. Mixpanel is NOT used here (it holds
// behaviour only). See growth.md.
//
//   GET /admin/growth/overview?days=30
//   GET /admin/growth/signup?days=30
//   GET /admin/growth/workout?days=30
//   GET /admin/growth/revenue?days=30
//   GET /admin/growth/retention
//   GET /admin/growth/list/:key        named action lists (see LISTS)
//
// Admin only. Read-only.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const ApiResponse = require("../../helper/ApiResponse");
const { isAdmin, adminsOnlyMessage } = require("../../helper/roles");

const PKT = "Asia/Karachi";
const M = () => require("../../models");
const DAY = 24 * 3600 * 1000;
const ATTENDED_SECONDS = require("../../helper/trialAttendance").minTrialAttendanceSeconds(); // 5 min (one rule)

// ── helpers ──────────────────────────────────────────────────────────
async function guard(req, res) {
  const { User } = M();
  const me = req.user && req.user.id ? await User.findByPk(req.user.id, { attributes: ["id", "userType"] }) : null;
  if (!isAdmin(me)) {
    res.json(ApiResponse("0", adminsOnlyMessage(me), {}));
    return false;
  }
  return true;
}
const period = (req) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const to = new Date();
  // days=1 is "Today": from Pakistan midnight, compared with all of yesterday.
  if (days === 1) {
    const midnight = moment().tz(PKT).startOf("day");
    return { days, from: midnight.toDate(), to, prevFrom: midnight.clone().subtract(1, "day").toDate() };
  }
  const from = new Date(to.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  return { days, from, to, prevFrom };
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const name = (u) => (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email || `#${u.id}` : "");
const wrap = (fn) => async (req, res) => {
  try {
    if (!(await guard(req, res))) return;
    const data = await fn(req);
    return res.json(ApiResponse("1", "ok", data));
  } catch (e) {
    console.error("[growth]", e);
    return res.json(ApiResponse("0", e.message, {}));
  }
};

/** Plan type the same way the app's one-truth helper does. */
function typeOfPlan(p) {
  if (!p) return null;
  const title = String(p.title || "").toLowerCase();
  if (title.startsWith("system") || title === "free trial") return null;
  if (p.planType) return p.planType;
  const cat = Number(p.CategoryId);
  if (cat === 1) return "diet";
  if (cat === 2) return "workout";
  if (cat === 3) return "combined";
  if (title.includes("combined") || title.includes("both")) return "combined";
  if (title.includes("diet")) return "diet";
  if (title.includes("workout")) return "workout";
  return null;
}
const merge = (types) =>
  types.has("combined") || (types.has("diet") && types.has("workout"))
    ? "combined"
    : types.has("diet")
    ? "diet"
    : types.has("workout")
    ? "workout"
    : null;

/** Map userId → { type, expireDate, buyingDate, planTitle } for women on a live PAID plan. */
async function paidNow() {
  const { UserPlan, Plan } = M();
  const rows = await UserPlan.findAll({
    where: {
      status: true,
      frozenAt: null,
      cancelledAt: null,
      isTrial: { [Op.not]: true },
      expireDate: { [Op.gte]: new Date() },
    },
    include: [{ model: Plan, attributes: ["id", "title", "CategoryId", "planType"] }],
  });
  const out = new Map();
  for (const r of rows) {
    const t = typeOfPlan(r.Plan);
    if (!t) continue;
    const cur = out.get(r.userId) || { types: new Set(), expireDate: r.expireDate, buyingDate: r.buyingDate, titles: [] };
    cur.types.add(t);
    if (r.expireDate > cur.expireDate) cur.expireDate = r.expireDate;
    if (r.buyingDate && (!cur.buyingDate || r.buyingDate < cur.buyingDate)) cur.buyingDate = r.buyingDate;
    cur.titles.push(r.Plan.title);
    out.set(r.userId, cur);
  }
  for (const v of out.values()) v.type = merge(v.types);
  return out;
}

/** userIds active (opened the app) since [since]. */
async function activeSince(since) {
  const { UserActiveDay, User } = M();
  const ids = new Set();
  try {
    const rows = await UserActiveDay.findAll({
      where: { day: { [Op.gte]: moment(since).tz(PKT).format("YYYY-MM-DD") } },
      attributes: ["userId"],
      group: ["userId"],
    });
    rows.forEach((r) => ids.add(r.userId));
  } catch (_) {}
  // Before the active-day history existed: last app open.
  const users = await User.findAll({ where: { appVersionAt: { [Op.gte]: since } }, attributes: ["id"] });
  users.forEach((u) => ids.add(u.id));
  return ids;
}

/** Sum of seconds per (userId, slotId, PKT day) from join/leave rows. */
async function presenceSince(since, extraWhere = {}) {
  const { ClassPresence } = M();
  const rows = await ClassPresence.findAll({
    where: { joinedAt: { [Op.gte]: since }, ...extraWhere },
    attributes: ["userId", "slotId", "joinedAt", "leftAt", "lastSeenAt", "durationSeconds"],
  });
  const map = new Map();
  for (const p of rows) {
    const day = moment(p.joinedAt).tz(PKT).format("YYYY-MM-DD");
    const key = `${p.userId}|${p.slotId}|${day}`;
    let secs = Number(p.durationSeconds) || 0;
    if (!p.leftAt) {
      // Joined through the Zoom app / app closed: assume 45 min max or until last seen.
      const last = p.lastSeenAt && p.lastSeenAt > p.joinedAt ? p.lastSeenAt : new Date(Math.min(Date.now(), p.joinedAt.getTime() + 45 * 60000));
      secs = Math.max(secs, Math.floor((last - p.joinedAt) / 1000));
    }
    const cur = map.get(key) || { userId: p.userId, slotId: p.slotId, day, secs: 0 };
    cur.secs += Math.max(0, secs);
    map.set(key, cur);
  }
  return [...map.values()];
}

async function usersByIds(ids, attrs = ["id", "firstName", "lastName", "email", "phone"]) {
  const { User } = M();
  if (!ids.length) return new Map();
  const rows = await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: attrs });
  return new Map(rows.map((u) => [u.id, u]));
}

async function revenueBetween(from, to) {
  const { PlanPurchase, PlanImage } = M();
  let purchases = [];
  try {
    purchases = await PlanPurchase.findAll({ where: { purchasedAt: { [Op.gte]: from, [Op.lt]: to } } });
  } catch (_) {}
  if (purchases.length) {
    return {
      source: "history",
      count: purchases.length,
      amount: purchases.reduce((s, p) => s + (p.amount || 0), 0),
      rows: purchases,
    };
  }
  // Before purchase history existed: approved slips (status 0).
  const slips = await PlanImage.findAll({
    where: { status: false, updatedAt: { [Op.gte]: from, [Op.lt]: to } },
    attributes: ["id", "UserId", "PlanId", "price", "paidAmount", "updatedAt"],
  });
  return {
    source: "approved_slips",
    count: slips.length,
    amount: slips.reduce((s, p) => s + (p.paidAmount || Number(p.price) || 0), 0),
    rows: [],
  };
}

// ── named lists ("act on these") ─────────────────────────────────────
const LISTS = {
  ending_soon: { title: "Plans ending in 7 days", hint: "Offer a renewal before it ends" },
  inactive_paid: { title: "Paid, no app open or class in 7 days", hint: "Check in before she cancels" },
  trial_offer_open: { title: "Trial done, offer still open", hint: "Remind her the offer ends soon" },
  workout_only_upsell: { title: "Workout-only for 30+ days", hint: "Offer to add a meal plan" },
  low_ratings: { title: "Low class ratings (1–2★), 7 days", hint: "Call and say sorry" },
  slipping: { title: "Slipping away", hint: "Used to come often, now quiet" },
  frozen: { title: "Plans on pause (frozen)", hint: "Say hello before she comes back" },
  no_trial_class: { title: "Started trial, no class yet", hint: "Help her book her first class" },
  symptom_high_no_diet: {
    title: "Symptom check moderate/high, no diet plan",
    hint: "Offer a condition-friendly meal plan (PCOS, thyroid…)",
  },
  signup_unfinished: {
    title: "Signed up, questions not finished (14 days)",
    hint: "Help her finish: she gets one reminder push",
  },
};

async function buildList(key) {
  const now = Date.now();
  const paid = await paidNow();
  const out = [];
  if (key === "ending_soon") {
    for (const [uid, p] of paid) {
      const left = Math.ceil((new Date(p.expireDate) - now) / DAY);
      if (left <= 7) out.push({ userId: uid, detail: `${p.type} · ends in ${left} day${left === 1 ? "" : "s"}`, sort: left, level: left <= 2 ? "high" : "medium" });
    }
  } else if (key === "inactive_paid" || key === "slipping") {
    const week = new Date(now - 7 * DAY);
    const active7 = await activeSince(week);
    const pres = await presenceSince(week);
    const inClass = new Set(pres.filter((x) => x.secs >= ATTENDED_SECONDS).map((x) => x.userId));
    if (key === "inactive_paid") {
      for (const [uid, p] of paid) {
        if (!active7.has(uid) && !inClass.has(uid)) out.push({ userId: uid, detail: `${p.type} · no app open or class in 7 days`, sort: 0, level: "high" });
      }
    } else {
      // Slipping: 3+ classes in the 3 weeks before, 0 in the last week.
      const before = await presenceSince(new Date(now - 28 * DAY));
      const count = new Map();
      for (const x of before) if (x.secs >= ATTENDED_SECONDS && new Date(x.day) < week) count.set(x.userId, (count.get(x.userId) || 0) + 1);
      for (const [uid, n] of count) {
        if (n >= 3 && !inClass.has(uid) && paid.has(uid)) {
          const p = paid.get(uid);
          const left = Math.ceil((new Date(p.expireDate) - now) / DAY);
          out.push({ userId: uid, detail: `${n} classes before · 0 this week · ends in ${left}d`, sort: left, level: left <= 10 ? "high" : "medium" });
        }
      }
    }
  } else if (key === "trial_offer_open") {
    const { TrialOffer } = M();
    const rows = await TrialOffer.findAll({ where: { redeemedAt: null, expiresAt: { [Op.gt]: new Date() } } });
    for (const r of rows) {
      if (paid.has(r.userId)) continue;
      const hrs = Math.max(0, Math.round((new Date(r.expiresAt) - now) / 3600000));
      out.push({ userId: r.userId, detail: `${r.percent}% off · ends in ${hrs < 48 ? hrs + "h" : Math.round(hrs / 24) + "d"}`, sort: hrs, level: hrs <= 24 ? "high" : "medium" });
    }
  } else if (key === "workout_only_upsell") {
    for (const [uid, p] of paid) {
      if (p.type !== "workout" || !p.buyingDate) continue;
      const d = Math.floor((now - new Date(p.buyingDate)) / DAY);
      if (d >= 30) out.push({ userId: uid, detail: `Workout only · ${d} days`, sort: -d, level: "medium" });
    }
  } else if (key === "low_ratings") {
    const { ClassFeedback } = M();
    const rows = await ClassFeedback.findAll({
      where: { rating: { [Op.lte]: 2 }, updatedAt: { [Op.gte]: new Date(now - 7 * DAY) } },
      order: [["updatedAt", "DESC"]],
    });
    for (const r of rows) {
      let tags = [];
      try {
        tags = JSON.parse(r.tags || "[]");
      } catch (_) {}
      out.push({ userId: r.userId, detail: `${r.rating}★ ${r.className || "class"} · ${r.classDate}${tags.length ? " · " + tags.join(", ") : ""}`, sort: 0, level: "high" });
    }
  } else if (key === "no_trial_class") {
    const { TrialJourney } = M();
    const rows = await TrialJourney.findAll({
      where: { convertedAt: null, day1AttendedAt: null, startedAt: { [Op.gte]: new Date(now - 7 * DAY) } },
    });
    for (const r of rows) {
      const d = Math.floor((now - new Date(r.startedAt)) / DAY);
      out.push({ userId: r.userId, detail: `Trial started ${d} day${d === 1 ? "" : "s"} ago · ${r.day1BookedAt ? "booked, didn't join" : "not booked"}`, sort: -d, level: "medium" });
    }
  } else if (key === "symptom_high_no_diet") {
    const { HealthScreening } = M();
    const rows = await HealthScreening.findAll({
      where: { riskLevel: { [Op.in]: ["moderate", "high"] }, createdAt: { [Op.gte]: new Date(now - 90 * DAY) } },
      order: [["createdAt", "DESC"]],
      attributes: ["userId", "conditionType", "riskLevel", "createdAt"],
    });
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.userId)) continue;
      seen.add(r.userId);
      const p = paid.get(r.userId);
      if (p && (p.type === "diet" || p.type === "combined")) continue;
      const d = Math.floor((now - new Date(r.createdAt)) / DAY);
      out.push({
        userId: r.userId,
        detail: `${r.conditionType}: ${r.riskLevel} · ${d === 0 ? "today" : d + "d ago"} · ${p ? p.type + " plan" : "no plan"}`,
        sort: r.riskLevel === "high" ? -1000 + d : d,
        level: r.riskLevel === "high" ? "high" : "medium",
      });
    }
  } else if (key === "frozen") {
    // Paused plans right now (Freeze v2: frozenAt set). Back on = frozenAt
    // + freezeDays (the auto-unfreeze), soonest first.
    const { UserPlan, Plan } = M();
    const rows = await UserPlan.findAll({
      where: { status: true, cancelledAt: null, frozenAt: { [Op.ne]: null }, isTrial: { [Op.not]: true } },
      include: [{ model: Plan, attributes: ["id", "title", "CategoryId", "planType"] }],
    });
    for (const r of rows) {
      const t = typeOfPlan(r.Plan);
      if (!t) continue;
      const since = moment(r.frozenAt).tz(PKT);
      const days = Math.max(0, Math.floor((now - since.valueOf()) / DAY));
      const back = r.freezeDays ? since.clone().add(r.freezeDays, "days") : null;
      const backIn = back ? Math.ceil((back.valueOf() - now) / DAY) : null;
      const parts = [
        `${t}`,
        `paused ${since.format("D MMM")} (${days === 0 ? "today" : days + "d ago"})`,
        back ? `back on ${back.format("D MMM")}` : "no end date",
      ];
      out.push({
        userId: r.userId,
        detail: parts.join(" · "),
        sort: backIn == null ? 9999 : backIn,
        level: backIn != null && backIn <= 2 ? "medium" : "low",
      });
    }
  } else if (key === "signup_unfinished") {
    const { User } = M();
    const STEPS = ["goal", "body", "life stage", "cycle", "health", "class time"];
    const rows = await User.findAll({
      where: {
        userType: "User",
        status: { [Op.not]: true },
        onboardingDoneAt: null,
        createdAt: { [Op.gte]: new Date(now - 14 * DAY) },
      },
      attributes: ["id", "createdAt", "onboardingStep", "onboardingReminderAt"],
    });
    for (const r of rows) {
      if (paid.has(r.id)) continue;
      const d = Math.floor((now - new Date(r.createdAt)) / DAY);
      const step = r.onboardingStep == null ? "account only" : `stopped at ${STEPS[r.onboardingStep] || "questions"}`;
      out.push({
        userId: r.id,
        detail: `${step} · ${d === 0 ? "today" : d + "d ago"}${r.onboardingReminderAt ? " · reminder sent" : ""}`,
        sort: d,
        level: d >= 2 ? "medium" : "low",
      });
    }
  } else {
    throw new Error("Unknown list");
  }
  out.sort((a, b) => a.sort - b.sort);
  const users = await usersByIds([...new Set(out.map((x) => x.userId))]);
  return out
    .filter((x) => users.has(x.userId))
    .map((x) => {
      const u = users.get(x.userId);
      return { userId: x.userId, name: name(u), phone: u.phone || null, detail: x.detail, level: x.level };
    });
}

// ── tabs ─────────────────────────────────────────────────────────────
exports.overview = wrap(async (req) => {
  const { User, TrialJourney, PlanPurchase, UserPlan } = M();
  const { days, from, prevFrom } = period(req);
  const signups = await User.count({ where: { userType: "User", createdAt: { [Op.gte]: from } } });
  const signupsPrev = await User.count({ where: { userType: "User", createdAt: { [Op.gte]: prevFrom, [Op.lt]: from } } });

  const paid = await paidNow();
  const trials = await TrialJourney.findAll({ where: { startedAt: { [Op.gte]: from } }, attributes: ["userId", "startedAt"] });
  const trialPaid = await paidAfter(trials.map((t) => ({ userId: t.userId, since: t.startedAt })));

  const rev = await revenueBetween(from, new Date());
  const revPrev = await revenueBetween(prevFrom, from);

  // Renewal rate: renewals ÷ (renewals + plans that ended without one).
  let renewals = 0;
  try {
    renewals = await PlanPurchase.count({ where: { kind: { [Op.in]: ["renewal", "upgrade"] }, purchasedAt: { [Op.gte]: from } } });
  } catch (_) {}
  const ended = await UserPlan.findAll({
    where: { isTrial: { [Op.not]: true }, expireDate: { [Op.gte]: from, [Op.lt]: new Date() } },
    attributes: ["userId"],
  });
  const lapsed = new Set(ended.map((e) => e.userId).filter((id) => !paid.has(id))).size;

  const active7 = await activeSince(new Date(Date.now() - 7 * DAY));
  const paidActive = [...paid.keys()].filter((id) => active7.has(id)).length;

  const counts = {};
  for (const k of Object.keys(LISTS)) {
    try {
      counts[k] = (await buildList(k)).length;
    } catch (_) {
      counts[k] = null;
    }
  }
  return {
    days,
    kpis: {
      signups,
      signupsChange: signupsPrev ? pct(signups - signupsPrev, signupsPrev) : null,
      trialToPaid: pct(trialPaid, trials.length),
      trialsStarted: trials.length,
      activePaid: paid.size,
      revenue: rev.amount,
      revenueChange: revPrev.amount ? pct(rev.amount - revPrev.amount, revPrev.amount) : null,
      revenueSource: rev.source,
      renewalRate: renewals + lapsed ? pct(renewals, renewals + lapsed) : null,
      activeThisWeekPct: pct(paidActive, paid.size),
    },
    lists: Object.entries(LISTS).map(([key, v]) => ({ key, title: v.title, hint: v.hint, count: counts[key] })),
  };
});

/** How many of these users got a paid plan after [since]. */
async function paidAfter(items) {
  return (await paidSetAfter(items)).size;
}

/** Which of these users got a paid plan after [since]. */
async function paidSetAfter(items) {
  if (!items.length) return new Set();
  const { UserPlan, Plan, PlanPurchase } = M();
  const ids = items.map((i) => i.userId);
  const since = new Map(items.map((i) => [i.userId, new Date(i.since)]));
  const plans = await UserPlan.findAll({
    where: { userId: { [Op.in]: ids }, isTrial: { [Op.not]: true } },
    include: [{ model: Plan, attributes: ["title", "CategoryId", "planType"] }],
    attributes: ["userId", "buyingDate", "createdAt"],
  });
  const got = new Set();
  for (const p of plans) {
    if (!typeOfPlan(p.Plan)) continue;
    const at = p.buyingDate || p.createdAt;
    if (at && at >= since.get(p.userId)) got.add(p.userId);
  }
  try {
    const pp = await PlanPurchase.findAll({ where: { userId: { [Op.in]: ids } }, attributes: ["userId", "purchasedAt"] });
    for (const p of pp) if (p.purchasedAt >= since.get(p.userId)) got.add(p.userId);
  } catch (_) {}
  return got;
}

exports.signup = wrap(async (req) => {
  const { User, TrialJourney } = M();
  const { days, from } = period(req);
  const users = await User.findAll({
    where: { userType: "User", createdAt: { [Op.gte]: from } },
    attributes: ["id", "createdAt", "mainGoal", "age", "signupMethod", "signupSource", "usedFreeTrial", "onboardingDoneAt"],
  });
  const ids = users.map((u) => u.id);
  const journeys = ids.length
    ? await TrialJourney.findAll({ where: { userId: { [Op.in]: ids } }, attributes: ["userId", "startedAt", "day1AttendedAt", "day2AttendedAt", "day3AttendedAt"] })
    : [];
  const jBy = new Map(journeys.map((j) => [j.userId, j]));
  // Finished the sign-up questions (older accounts: goal or age saved).
  const profile = users.filter((u) => u.onboardingDoneAt || (!u.onboardingDoneAt && u.mainGoal && u.age && new Date(u.createdAt) < new Date("2026-10-22")));
  const trial = users.filter((u) => jBy.has(u.id) || u.usedFreeTrial);
  const c1 = users.filter((u) => jBy.get(u.id) && jBy.get(u.id).day1AttendedAt);
  const c3 = users.filter((u) => jBy.get(u.id) && jBy.get(u.id).day3AttendedAt);
  const paidSet = await paidSetAfter(users.map((u) => ({ userId: u.id, since: u.createdAt })));
  const paidCount = paidSet.size;
  const group = (key, fallback) => {
    const m = new Map();
    for (const u of users) {
      const k = u[key] || fallback;
      const cur = m.get(k) || { name: k, signups: 0, paid: 0 };
      cur.signups++;
      if (paidSet.has(u.id)) cur.paid++;
      m.set(k, cur);
    }
    return [...m.values()].map((x) => ({ ...x, paidPct: pct(x.paid, x.signups) })).sort((a, b) => b.signups - a.signups);
  };
  const n = users.length;
  return {
    days,
    funnel: [
      { step: "Accounts created", count: n, pct: 100 },
      { step: "Profile finished", count: profile.length, pct: pct(profile.length, n) },
      { step: "Trial started", count: trial.length, pct: pct(trial.length, n) },
      { step: "Attended class 1", count: c1.length, pct: pct(c1.length, n) },
      { step: "Attended all 3", count: c3.length, pct: pct(c3.length, n) },
      { step: "Paid", count: paidCount, pct: pct(paidCount, n) },
    ],
    bySource: group("signupSource", "unknown (before Oct 2026)"),
    byMethod: group("signupMethod", "unknown (before Oct 2026)"),
  };
});

exports.workout = wrap(async (req) => {
  const { Slot, User, ClassSession, ClassFeedback } = M();
  const { days, from } = period(req);
  const pres = await presenceSince(from);
  const attended = pres.filter((x) => x.secs >= ATTENDED_SECONDS);
  // Classes that had at least one woman (works for past days too).
  const classDays = new Map();
  for (const x of pres) {
    const k = `${x.slotId}|${x.day}`;
    const c = classDays.get(k) || { slotId: x.slotId, joined: 0, attended: 0, mins: 0 };
    c.joined++;
    if (x.secs >= ATTENDED_SECONDS) {
      c.attended++;
      c.mins += x.secs / 60;
    }
    classDays.set(k, c);
  }
  let sessions = [];
  try {
    sessions = await ClassSession.findAll({ where: { date: { [Op.gte]: moment(from).tz(PKT).format("YYYY-MM-DD") } } });
  } catch (_) {}
  const cancelled = sessions.filter((s) => s.status === "cancelled").length;
  const autoCancelled = sessions.filter((s) => s.status === "auto_cancelled").length;

  // Per slot
  const slots = await Slot.findAll({ attributes: ["id", "type", "start", "end", "trainerId"], include: [{ model: User, attributes: ["id", "firstName", "lastName"] }] });
  const slotBy = new Map(slots.map((s) => [s.id, s]));
  const fb = await ClassFeedback.findAll({ where: { rating: { [Op.ne]: null }, updatedAt: { [Op.gte]: from } }, attributes: ["slotId", "trainerId", "rating", "tags"] });
  const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
  const bySlot = new Map();
  for (const c of classDays.values()) {
    const s = bySlot.get(c.slotId) || { slotId: c.slotId, classes: 0, joined: 0, attended: 0, mins: 0 };
    s.classes++;
    s.joined += c.joined;
    s.attended += c.attended;
    s.mins += c.mins;
    bySlot.set(c.slotId, s);
  }
  const slotRows = [...bySlot.values()].map((s) => {
    const sl = slotBy.get(s.slotId);
    return {
      slotId: s.slotId,
      label: sl ? `${sl.start || ""} ${(sl.type || "").trim()}`.trim() : `Class #${s.slotId}`,
      trainer: sl ? name(sl.User) : "",
      avgWomen: Math.round((s.attended / s.classes) * 10) / 10,
      avgMinutes: s.attended ? Math.round(s.mins / s.attended) : null,
      stayedPct: pct(s.attended, s.joined),
      rating: avg(fb.filter((f) => f.slotId === s.slotId).map((f) => f.rating)),
    };
  }).sort((a, b) => b.avgWomen - a.avgWomen);

  // Trainers (punctuality from the class diary; attendance from presence)
  const trainerIds = [...new Set(slots.map((s) => s.trainerId).filter(Boolean))];
  const trainers = await usersByIds(trainerIds, ["id", "firstName", "lastName", "email"]);
  const trainerRows = trainerIds.map((tid) => {
    const ss = sessions.filter((s) => s.trainerId === tid);
    const started = ss.filter((s) => s.startLateMinutes != null);
    const late = started.map((s) => s.startLateMinutes);
    const myCd = [...classDays.values()].filter((c) => slotBy.get(c.slotId) && slotBy.get(c.slotId).trainerId === tid);
    const myFb = fb.filter((f) => f.trainerId === tid);
    const tagCount = {};
    for (const f of myFb) {
      if (f.rating > 3) continue;
      try {
        JSON.parse(f.tags || "[]").forEach((t) => (tagCount[t] = (tagCount[t] || 0) + 1));
      } catch (_) {}
    }
    const top = Object.entries(tagCount).sort((a, b) => b[1] - a[1])[0];
    return {
      trainerId: tid,
      name: name(trainers.get(tid)),
      classesHeld: myCd.length,
      onTimePct: started.length ? pct(late.filter((m) => m <= 2).length, started.length) : null,
      avgLateMinutes: late.length ? Math.round(late.reduce((a, b) => a + Math.max(0, b), 0) / late.length) : null,
      cancelled: ss.filter((s) => s.status === "cancelled").length,
      autoCancelled: ss.filter((s) => s.status === "auto_cancelled").length,
      forgotToEnd: ss.filter((s) => s.endedBy === "system").length,
      usedOtherLink: ss.filter((s) => s.usedOtherLink).length,
      avgWomen: myCd.length ? Math.round((myCd.reduce((a, c) => a + c.attended, 0) / myCd.length) * 10) / 10 : null,
      rating: avg(myFb.map((f) => f.rating)),
      ratings: myFb.length,
      topIssue: top ? `${top[0]} (${top[1]})` : null,
    };
  }).filter((t) => t.classesHeld || t.cancelled || t.autoCancelled).sort((a, b) => (a.onTimePct ?? 101) - (b.onTimePct ?? 101));

  // Class diary (Oct 2026): every class in the period with how the
  // trainer ran it and how many women came. "Today" also lists the
  // classes that haven't started yet.
  const diary = await buildClassDiary({ sessions, pres, slotBy, from, today: days === 1 });

  // By weekday
  const byDay = {};
  for (const x of attended) {
    const d = moment.tz(x.day, PKT).format("ddd");
    byDay[d] = (byDay[d] || 0) + 1;
  }
  const uniqueWomen = new Set(attended.map((x) => x.userId)).size;
  const totalJoined = pres.length;
  return {
    days,
    diarySince: sessions.length ? sessions.map((s) => s.date).sort()[0] : null,
    kpis: {
      // Started by the trainer (class diary), or had a woman in it.
      classesHeld: Math.max(classDays.size, sessions.filter((x) => x.startedAt).length),
      cancelled,
      autoCancelled,
      stayedPct: pct(attended.length, totalJoined),
      avgMinutes: attended.length ? Math.round(attended.reduce((a, x) => a + x.secs, 0) / attended.length / 60) : null,
      womenAttended: uniqueWomen,
      avgWomenPerClass: classDays.size ? Math.round((attended.length / classDays.size) * 10) / 10 : null,
    },
    byWeekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => ({ day: d, attended: byDay[d] || 0 })),
    slots: slotRows,
    trainers: trainerRows,
    diary,
    attendMinutes: Math.round(ATTENDED_SECONDS / 60),
  };
});

async function buildClassDiary({ sessions, pres, slotBy, from, today }) {
  const { Slot, Time, User, ClassFeedback } = M();
  const fromDay = moment(from).tz(PKT).format("YYYY-MM-DD");
  const todayKey = moment.tz(PKT).format("YYYY-MM-DD");
  const rows = sessions.map((x) => ({ s: x, slotId: x.slotId, date: x.date }));
  if (today) {
    // Today's classes with no diary row yet (not started / not cancelled).
    const have = new Set(rows.filter((r) => r.date === todayKey).map((r) => r.slotId));
    const todays = await Slot.findAll({
      where: { trainerId: { [Op.ne]: null } },
      attributes: ["id", "type", "start", "end", "trainerId", "status"],
      include: [{ model: Time, attributes: ["day"], where: { day: moment.tz(PKT).format("dddd") } }],
    });
    for (const sl of todays) if (!have.has(sl.id)) rows.push({ s: null, slotId: sl.id, date: todayKey, slot: sl });
  }
  if (!rows.length) return [];
  let fb = [];
  try {
    fb = await ClassFeedback.findAll({
      where: { classDate: { [Op.gte]: fromDay }, rating: { [Op.ne]: null } },
      attributes: ["slotId", "classDate", "rating"],
    });
  } catch (_) {}
  const trainerIds = new Set();
  rows.forEach((r) => {
    const sl = r.slot || slotBy.get(r.slotId);
    const tid = (r.s && r.s.trainerId) || (sl && sl.trainerId);
    if (tid) trainerIds.add(tid);
  });
  const trainers = await usersByIds([...trainerIds], ["id", "firstName", "lastName"]);
  const t = (d) => (d ? moment(d).tz(PKT).format("h:mm A") : null);
  const out = rows.map((r) => {
    const x = r.s;
    const sl = r.slot || slotBy.get(r.slotId);
    const tid = (x && x.trainerId) || (sl && sl.trainerId);
    const mine = pres.filter((p) => p.slotId === r.slotId && p.day === r.date);
    const came = mine.filter((p) => p.secs >= ATTENDED_SECONDS);
    const rates = fb.filter((f) => f.slotId === r.slotId && String(f.classDate) === r.date).map((f) => f.rating);
    let status = x ? x.status : "upcoming";
    if (!x && sl && sl.status === "In Progress") status = "live";
    const endAt = x && (x.endedAt || (status === "live" ? new Date() : null));
    return {
      date: r.date,
      slotId: r.slotId,
      className: ((x && x.className) || (sl && sl.type) || "Class").trim(),
      scheduled: `${(sl && sl.start) || (x && t(x.scheduledStart)) || ""} – ${(sl && sl.end) || (x && t(x.scheduledEnd)) || ""}`,
      trainer: name(trainers.get(tid)) || "",
      status, // upcoming / live / completed / cancelled / auto_cancelled
      startedAt: x ? t(x.startedAt) : null,
      lateMinutes: x && x.startLateMinutes != null ? x.startLateMinutes : null, // minus = early
      endedAt: x ? t(x.endedAt) : null,
      endedBy: x ? x.endedBy : null, // trainer / admin / system (forgot to end)
      ranMinutes: x && x.startedAt && endAt ? Math.max(0, Math.round((new Date(endAt) - new Date(x.startedAt)) / 60000)) : null,
      usedOtherLink: !!(x && x.usedOtherLink),
      joined: mine.length,
      attended: came.length,
      avgMinutes: came.length ? Math.round(came.reduce((a, p) => a + p.secs, 0) / came.length / 60) : null,
      rating: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : null,
      ratings: rates.length,
      _sort: `${r.date} ${String(moment((sl && sl.start) || "12:00 AM", "hh:mm A").format("HH:mm"))}`,
    };
  });
  out.sort((a, b) => (a._sort < b._sort ? 1 : -1));
  if (today) out.reverse(); // today: morning first
  return out.slice(0, 80).map(({ _sort, ...rest }) => rest);
}

exports.revenue = wrap(async (req) => {
  const { PaymentAttempt, PlanImage } = M();
  const { days, from } = period(req);
  const rev = await revenueBetween(from, new Date());
  const kinds = { new: { count: 0, amount: 0 }, renewal: { count: 0, amount: 0 }, upgrade: { count: 0, amount: 0 }, switch: { count: 0, amount: 0 } };
  const paths = {};
  for (const p of rev.rows) {
    const k = kinds[p.kind] || kinds.new;
    k.count++;
    k.amount += p.amount || 0;
    if (p.kind === "upgrade" || p.kind === "switch") {
      const key = `${p.previousPlanType || "?"} → ${p.planType || "?"}`;
      paths[key] = (paths[key] || 0) + 1;
    }
  }
  const lifetime = {};
  for (const p of rev.rows) lifetime[p.userId] = (lifetime[p.userId] || 0) + (p.amount || 0);
  const lt = Object.values(lifetime);

  const paid = await paidNow();
  const byType = { combined: 0, workout: 0, diet: 0 };
  for (const v of paid.values()) if (byType[v.type] != null) byType[v.type]++;

  let attempts = [];
  try {
    attempts = await PaymentAttempt.findAll({ where: { createdAt: { [Op.gte]: from } }, attributes: ["status", "method"] });
  } catch (_) {}
  const st = (s) => attempts.filter((a) => a.status === s).length;
  const pendingSlips = await PlanImage.count({ where: { status: true } });
  const methods = {};
  for (const a of attempts) methods[a.method || "?"] = (methods[a.method || "?"] || 0) + 1;
  return {
    days,
    source: rev.source,
    total: { count: rev.count, amount: rev.amount },
    kinds,
    upgradePaths: Object.entries(paths).map(([path, count]) => ({ path, count })),
    avgLifetimeValue: lt.length ? Math.round(lt.reduce((a, b) => a + b, 0) / lt.length) : null,
    activeByType: byType,
    payments: { approved: st("approved"), rejected: st("rejected"), pending: pendingSlips, directPayOpened: st("initiated"), methods },
  };
});

exports.retention = wrap(async () => {
  const { PlanImage, UserPlan } = M();
  const paid = await paidNow();
  // Cohorts: month of her first approved payment (slips survive deletion).
  const slips = await PlanImage.findAll({
    where: { status: false, UserId: { [Op.ne]: null } },
    attributes: ["UserId", "updatedAt"],
    order: [["updatedAt", "ASC"]],
  });
  const firstBy = new Map();
  const countBy = new Map();
  for (const s of slips) {
    if (!firstBy.has(s.UserId)) firstBy.set(s.UserId, s.updatedAt);
    countBy.set(s.UserId, (countBy.get(s.UserId) || 0) + 1);
  }
  const cohorts = [];
  for (let i = 5; i >= 0; i--) {
    const m = moment.tz(PKT).subtract(i, "months");
    const key = m.format("YYYY-MM");
    const members = [...firstBy.entries()].filter(([, d]) => moment(d).tz(PKT).format("YYYY-MM") === key).map(([u]) => u);
    cohorts.push({
      month: m.format("MMM YYYY"),
      women: members.length,
      renewedPct: pct(members.filter((u) => (countBy.get(u) || 0) > 1).length, members.length),
      activeNowPct: pct(members.filter((u) => paid.has(u)).length, members.length),
    });
  }
  // What keeps women: classes in their first 30 days vs renewed.
  const keep = { "8+ classes in month 1": [0, 0], "4–7 classes": [0, 0], "0–3 classes": [0, 0] };
  const pres = await presenceSince(new Date(Date.now() - 365 * DAY));
  const att = pres.filter((x) => x.secs >= ATTENDED_SECONDS);
  for (const [u, first] of firstBy) {
    const end = new Date(first.getTime() + 30 * DAY);
    const n = att.filter((x) => x.userId === u && new Date(x.day) >= first && new Date(x.day) < end).length;
    const bucket = n >= 8 ? "8+ classes in month 1" : n >= 4 ? "4–7 classes" : "0–3 classes";
    keep[bucket][0]++;
    if ((countBy.get(u) || 0) > 1) keep[bucket][1]++;
  }
  const reasons = await UserPlan.findAll({ where: { cancelledAt: { [Op.ne]: null } }, attributes: ["cancelReason"] });
  const rc = {};
  for (const r of reasons) {
    const k = (r.cancelReason || "No reason given").trim().slice(0, 40);
    rc[k] = (rc[k] || 0) + 1;
  }
  return {
    cohorts,
    whatKeeps: Object.entries(keep).map(([group, [women, renewed]]) => ({ group, women, renewedPct: pct(renewed, women) })),
    slipping: (await buildList("slipping")).slice(0, 30),
    frozen: await buildList("frozen"),
    cancelReasons: Object.entries(rc).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
});

exports.list = wrap(async (req) => {
  const key = req.params.key;
  if (!LISTS[key]) throw new Error("Unknown list");
  return { key, ...LISTS[key], people: await buildList(key) };
});

// ── day-by-day numbers for the dashboard charts ──────────────────────
//   GET /admin/growth/trends?days=30
// One value per Pakistan day (oldest first) + revenue per week by kind.
exports.trends = wrap(async (req) => {
  const { User } = M();
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 180);
  const start = moment().tz(PKT).startOf("day").subtract(days - 1, "days");
  const from = start.toDate();
  const keys = [];
  for (let i = 0; i < days; i++) keys.push(start.clone().add(i, "days").format("YYYY-MM-DD"));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const zero = () => keys.map(() => 0);
  const dayOf = (d) => moment(d).tz(PKT).format("YYYY-MM-DD");
  const weekOf = (d) => moment(d).tz(PKT).startOf("isoWeek").format("YYYY-MM-DD");

  const signups = zero();
  const users = await User.findAll({ where: { userType: "User", createdAt: { [Op.gte]: from } }, attributes: ["createdAt"] });
  for (const u of users) {
    const i = idx.get(dayOf(u.createdAt));
    if (i != null) signups[i] += 1;
  }

  const revenue = zero();
  const becamePaid = zero();
  const weeks = new Map(); // week -> {new, renewal, upgrade}
  const addWeek = (d, kind, amount) => {
    const w = weekOf(d);
    const cur = weeks.get(w) || { week: w, new: 0, renewal: 0, upgrade: 0 };
    const k = kind === "renewal" || kind === "upgrade" ? kind : "new";
    cur[k] += amount;
    weeks.set(w, cur);
  };
  const rev = await revenueBetween(from, new Date());
  if (rev.source === "history") {
    for (const p of rev.rows) {
      const i = idx.get(dayOf(p.purchasedAt));
      if (i == null) continue;
      const amount = p.amount || 0;
      revenue[i] += amount;
      if ((p.kind || "new") === "new") becamePaid[i] += 1;
      addWeek(p.purchasedAt, p.kind, amount);
    }
  } else {
    const { PlanImage } = M();
    const slips = await PlanImage.findAll({
      where: { status: false, updatedAt: { [Op.gte]: from } },
      attributes: ["price", "paidAmount", "updatedAt"],
    });
    for (const p of slips) {
      const i = idx.get(dayOf(p.updatedAt));
      if (i == null) continue;
      const amount = p.paidAmount || Number(p.price) || 0;
      revenue[i] += amount;
      becamePaid[i] += 1;
      addWeek(p.updatedAt, "new", amount);
    }
  }

  // Women in class (stayed 10+ minutes), counted once per day.
  const attended = zero();
  const seen = new Set();
  for (const r of await presenceSince(from)) {
    if (r.secs < ATTENDED_SECONDS) continue;
    const key = `${r.day}|${r.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const i = idx.get(r.day);
    if (i != null) attended[i] += 1;
  }

  return {
    days,
    dates: keys,
    signups,
    becamePaid,
    revenue,
    attended,
    revenueSource: rev.source,
    revenueByWeek: [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1)),
  };
});
