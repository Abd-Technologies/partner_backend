// Every customer's current plan state, for the CRM's nightly sync (Nov 2026).
// Same rules as helper/crmHooks.js hasOtherPaidPlan(): a paid plan is live when
// status is on, not cancelled, not past expiry, and planStatus is not
// expired / cancelled / completed.
//
//   page({ limit, offset }) → { count, offset, limit, subscriptions: [
//     { app_user_id, status, plan_title, expires_at } ] }
//   status: active | frozen | trial | expired | cancelled | none
const { Op } = require("sequelize");

const ENDED = ["expired", "cancelled", "completed"];

function isLive(p, now) {
  return p.status !== false && p.status !== 0 && !p.cancelledAt &&
    p.expireDate && new Date(p.expireDate) > now &&
    (!p.planStatus || !ENDED.includes(String(p.planStatus).toLowerCase()));
}

function stateFor(plans, titles, now = new Date()) {
  const byExpiry = (a, b) => new Date(b.expireDate || 0) - new Date(a.expireDate || 0);
  const paid = plans.filter((p) => !p.isTrial).sort(byExpiry);
  const trials = plans.filter((p) => p.isTrial).sort(byExpiry);
  const pick = (p, status) => ({ status, plan_title: titles.get(p.PlanId) || null, expires_at: p.expireDate || null });

  const livePaid = paid.find((p) => isLive(p, now));
  if (livePaid) return pick(livePaid, livePaid.frozenAt ? "frozen" : "active");
  const liveTrial = trials.find((p) => isLive(p, now));
  if (liveTrial) return pick(liveTrial, "trial");
  if (paid.length) {
    const last = paid[0];
    const cancelled = last.cancelledAt || String(last.planStatus || "").toLowerCase() === "cancelled";
    return pick(last, cancelled ? "cancelled" : "expired");
  }
  if (trials.length) return pick(trials[0], "expired");
  return { status: "none", plan_title: null, expires_at: null };
}

/**
 * extrasFor(userIds, plans) — what makes her personal to the CRM (Nov 2026):
 *   trial_started_at, trial_expires_at, trial_classes_attended (0–3),
 *   frozen_at (her live paid plan is frozen since), classes_total (days she
 *   attended a class, same 5-minute rule as trial attendance), last_class_at.
 * → Map(userId → extras). `plans` = her UserPlan rows (already loaded).
 */
async function extrasFor(ids, plans, now = new Date()) {
  const out = new Map(ids.map((id) => [id, {
    trial_started_at: null, trial_expires_at: null, trial_classes_attended: 0,
    frozen_at: null, classes_total: 0, last_class_at: null,
  }]));
  if (!ids.length) return out;
  const { TrialJourney, sequelize } = require("../models");

  // Trial dates: her journey's start, else her newest trial plan.
  const byExpiry = (a, b) => new Date(b.expireDate || 0) - new Date(a.expireDate || 0);
  for (const id of ids) {
    const mine = plans.filter((p) => p.userId === id);
    const trial = mine.filter((p) => p.isTrial).sort(byExpiry)[0];
    const o = out.get(id);
    if (trial) { o.trial_started_at = trial.buyingDate || null; o.trial_expires_at = trial.expireDate || null; }
    const liveFrozen = mine.filter((p) => !p.isTrial && p.frozenAt && isLive(p, now)).sort(byExpiry)[0];
    if (liveFrozen) o.frozen_at = liveFrozen.frozenAt;
  }
  try {
    const journeys = await TrialJourney.findAll({
      where: { userId: { [Op.in]: ids } },
      attributes: ["userId", "startedAt", "day1AttendedAt", "day2AttendedAt", "day3AttendedAt"],
      raw: true,
    });
    for (const j of journeys) {
      const o = out.get(j.userId);
      if (!o) continue;
      if (j.startedAt) o.trial_started_at = j.startedAt;
      o.trial_classes_attended = ["day1AttendedAt", "day2AttendedAt", "day3AttendedAt"].filter((k) => j[k]).length;
    }
  } catch (e) { console.warn("[subscriptionState] trial journeys:", e.message); }

  // Classes: a day counts when her time in class that day reaches the rule.
  try {
    const min = require("./trialAttendance").minTrialAttendanceSeconds();
    const [rows] = await sequelize.query(
      `SELECT userId, COUNT(*) AS n, MAX(last_at) AS last_at FROM (
         SELECT userId, DATE(joinedAt) AS d, SUM(durationSeconds) AS secs, MAX(COALESCE(leftAt, joinedAt)) AS last_at
           FROM ClassPresences WHERE userId IN (:ids)
          GROUP BY userId, DATE(joinedAt)
         HAVING secs >= :min) x
       GROUP BY userId`,
      { replacements: { ids, min } }
    );
    for (const r of rows) {
      const o = out.get(Number(r.userId));
      if (o) { o.classes_total = Number(r.n) || 0; o.last_class_at = r.last_at || null; }
    }
  } catch (e) { console.warn("[subscriptionState] classes:", e.message); }
  return out;
}

async function page({ limit = 500, offset = 0 } = {}) {
  const { User, UserPlan, Plan } = require("../models");
  const lim = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 2000);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  const users = await User.findAll({
    where: { userType: { [Op.in]: ["User", "user"] } },
    attributes: ["id"], order: [["id", "ASC"]], limit: lim, offset: off, raw: true,
  });
  const ids = users.map((u) => u.id);
  const plans = ids.length
    ? await UserPlan.findAll({
        where: { userId: { [Op.in]: ids } },
        attributes: ["id", "userId", "PlanId", "isTrial", "status", "planStatus", "expireDate", "frozenAt", "cancelledAt", "buyingDate"],
        raw: true,
      })
    : [];
  const planIds = [...new Set(plans.map((p) => p.PlanId).filter(Boolean))];
  const titles = new Map(
    (planIds.length ? await Plan.findAll({ where: { id: { [Op.in]: planIds } }, attributes: ["id", "title"], raw: true }) : [])
      .map((p) => [p.id, p.title])
  );
  const byUser = new Map(ids.map((id) => [id, []]));
  for (const p of plans) byUser.get(p.userId)?.push(p);
  const now = new Date();
  const extras = await extrasFor(ids, plans, now);
  return {
    count: users.length, offset: off, limit: lim,
    subscriptions: ids.map((id) => ({ app_user_id: String(id), ...stateFor(byUser.get(id), titles, now), ...extras.get(id) })),
  };
}

module.exports = { page, stateFor, isLive, extrasFor };
