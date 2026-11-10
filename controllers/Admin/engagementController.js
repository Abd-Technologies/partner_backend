// Admin › Engagement (Nov 2026): how many women use each feature.
//
//   GET /admin/engagement?days=1|7|30   (&fresh=1 to skip the cache)
//
// Light on the live server on purpose:
//   * read-only, no new tables, no migrations, nothing runs in the background;
//   * only runs when an admin opens the page;
//   * the answer is kept in redis for 10 minutes, so opening the page again
//     (or another admin opening it) costs nothing.
// Counts women (clients only, no staff), split into paid and free trial.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const ApiResponse = require("../../helper/ApiResponse");
const { isAdmin, adminsOnlyMessage } = require("../../helper/roles");

const PKT = "Asia/Karachi";
const CACHE_SECONDS = 10 * 60;
const M = () => require("../../models");

let _redis = null;
function redis() {
  if (_redis) return _redis;
  try {
    const Redis = require("ioredis");
    _redis = new Redis({ lazyConnect: false, maxRetriesPerRequest: 1 });
    _redis.on("error", () => {});
  } catch (_) {
    _redis = null;
  }
  return _redis;
}

const ids = (rows) => new Set(rows.map((r) => r.userId).filter(Boolean));
const union = (...sets) => {
  const out = new Set();
  sets.forEach((s) => s.forEach((v) => out.add(v)));
  return out;
};
async function distinctUsers(Model, where) {
  try {
    const rows = await Model.findAll({ where, attributes: ["userId"], group: ["userId"], raw: true });
    return ids(rows);
  } catch (e) {
    console.error("[engagement]", Model && Model.name, e.message);
    return new Set();
  }
}
async function countRows(Model, where) {
  try {
    return await Model.count({ where });
  } catch (_) {
    return 0;
  }
}

/** Women on a running paid plan right now. */
async function paidNowIds() {
  const { UserPlan, Plan } = M();
  const rows = await UserPlan.findAll({
    where: {
      status: true,
      cancelledAt: null,
      isTrial: { [Op.not]: true },
      expireDate: { [Op.gte]: new Date() },
    },
    include: [{
      model: Plan,
      required: true,
      attributes: [],
      where: {
        [Op.and]: [
          { title: { [Op.ne]: "Free Trial" } },
          { title: { [Op.notLike]: "system%" } },
          { title: { [Op.notLike]: "%trial%" } },
        ],
      },
    }],
    attributes: ["userId"],
    raw: true,
  });
  return ids(rows);
}

/** Women on a free trial that is still running. */
async function trialNowIds() {
  const { TrialJourney } = M();
  let days = 3;
  try { days = require("../../helper/trialState").getTrialDays(); } catch (_) {}
  const rows = await TrialJourney.findAll({
    where: { convertedAt: null, startedAt: { [Op.gte]: moment().subtract(days, "days").toDate() } },
    attributes: ["userId"],
    raw: true,
  });
  return ids(rows);
}

async function build(days) {
  const m = M();
  const from = days === 1 ? moment().tz(PKT).startOf("day") : moment().tz(PKT).subtract(days, "days");
  const fromDate = from.toDate();
  const fromDay = from.format("YYYY-MM-DD");

  const [paid, trial, opened] = await Promise.all([
    paidNowIds(),
    trialNowIds(),
    m.UserActiveDay ? distinctUsers(m.UserActiveDay, { day: { [Op.gte]: fromDay } }) : new Set(),
  ]);

  // Daily insights (Home: feeling, water, sleep).
  const [mood, sleep, water, flow, cycle] = await Promise.all([
    distinctUsers(m.DailyCheckin, { date: { [Op.gte]: fromDay }, moodLevel: { [Op.ne]: null } }),
    distinctUsers(m.DailyCheckin, { date: { [Op.gte]: fromDay }, sleepHours: { [Op.ne]: null } }),
    distinctUsers(m.WaterLog, { date: { [Op.gte]: fromDay } }),
    distinctUsers(m.DailyCheckin, { date: { [Op.gte]: fromDay }, periodFlow: { [Op.ne]: null } }),
    distinctUsers(m.UserCycleData, { updatedAt: { [Op.gte]: fromDate }, dataProvided: 1 }),
  ]);

  // Weekly progress.
  const [checkins, weighIns, checkinCount] = await Promise.all([
    distinctUsers(m.WeeklyCheckin, { updatedAt: { [Op.gte]: fromDate }, checkinDay: { [Op.ne]: null } }),
    distinctUsers(m.WeeklyCheckin, { updatedAt: { [Op.gte]: fromDate }, weightKg: { [Op.ne]: null } }),
    countRows(m.WeeklyCheckin, { updatedAt: { [Op.gte]: fromDate }, checkinDay: { [Op.ne]: null } }),
  ]);

  // Community.
  const since = { createdAt: { [Op.gte]: fromDate } };
  const [posters, repliers, likers, postCount, replyCount, likeCount] = await Promise.all([
    distinctUsers(m.Post, { ...since, isPost: true }),
    distinctUsers(m.Reply, since),
    distinctUsers(m.Like, since),
    countRows(m.Post, { ...since, isPost: true }),
    countRows(m.Reply, since),
    countRows(m.Like, since),
  ]);

  // Clients only (drop staff: trainers, dietitians, admins).
  const everyone = union(mood, sleep, water, flow, cycle, checkins, weighIns, posters, repliers, likers);
  const clients = new Set();
  if (everyone.size) {
    const rows = await m.User.findAll({
      where: { id: { [Op.in]: [...everyone] }, userType: "User" },
      attributes: ["id"],
      raw: true,
    });
    rows.forEach((r) => clients.add(r.id));
  }
  const only = (s) => new Set([...s].filter((v) => clients.has(v)));

  const row = (key, title, hint, set, extra = {}) => {
    const s = only(set);
    let p = 0, t = 0;
    s.forEach((v) => { if (paid.has(v)) p++; else if (trial.has(v)) t++; });
    return { key, title, hint, users: s.size, paid: p, trial: t, other: s.size - p - t, ...extra };
  };

  const insightsAny = union(mood, sleep, water);
  const periodAny = union(flow, cycle);
  const communityAny = union(posters, repliers, likers);

  return {
    days,
    from: fromDate.toISOString(),
    generatedAt: new Date().toISOString(),
    base: { paid: paid.size, trial: trial.size, openedApp: only(opened).size || opened.size },
    groups: [
      {
        title: "Daily insights",
        rows: [
          row("insights_any", "Logged any daily insight", "Feeling, water or sleep on Home", insightsAny),
          row("mood", "Feeling", "Mood / energy check-in", mood),
          row("water", "Water", "Added water", water),
          row("sleep", "Sleep", "Logged sleep hours", sleep),
        ],
      },
      {
        title: "Period",
        rows: [
          row("period_any", "Logged or updated her period", "Period date or daily flow", periodAny),
          row("period_date", "Updated period date", "New period start / cycle info", cycle),
          row("period_flow", "Logged daily flow", "Flow on a period day", flow),
        ],
      },
      {
        title: "Weekly progress",
        rows: [
          row("weekly_checkin", "Did a weekly check-in", "Week 1, weekly, halfway, end", checkins, { actions: checkinCount }),
          row("weigh_in", "Logged weight", "Any weigh-in, check-in or Home tile", weighIns),
        ],
      },
      {
        title: "Community",
        rows: [
          row("community_any", "Took part in the community", "Posted, replied or liked", communityAny),
          row("posts", "Posted", "New posts", posters, { actions: postCount }),
          row("replies", "Replied", "Comments on posts", repliers, { actions: replyCount }),
          row("likes", "Liked", "Likes on posts", likers, { actions: likeCount }),
        ],
      },
    ],
  };
}

async function engagement(req, res) {
  try {
    const { User } = M();
    const me = req.user && req.user.id ? await User.findByPk(req.user.id, { attributes: ["id", "userType"] }) : null;
    if (!isAdmin(me)) return res.json(ApiResponse("0", adminsOnlyMessage(me), {}));

    const raw = parseInt(req.query.days, 10);
    const days = [1, 7, 30].includes(raw) ? raw : 7;
    const key = `admin:engagement:${days}`;
    const r = redis();
    if (r && req.query.fresh !== "1") {
      try {
        const hit = await r.get(key);
        if (hit) return res.json(ApiResponse("1", "ok", { ...JSON.parse(hit), cached: true }));
      } catch (_) {}
    }
    const data = await build(days);
    if (r) {
      try { await r.set(key, JSON.stringify(data), "EX", CACHE_SECONDS); } catch (_) {}
    }
    return res.json(ApiResponse("1", "ok", { ...data, cached: false }));
  } catch (e) {
    console.error("[engagement]", e);
    return res.json(ApiResponse("0", "Couldn't load engagement right now.", {}));
  }
}

module.exports = { engagement };
