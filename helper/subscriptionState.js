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
        attributes: ["id", "userId", "PlanId", "isTrial", "status", "planStatus", "expireDate", "frozenAt", "cancelledAt"],
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
  return {
    count: users.length, offset: off, limit: lim,
    subscriptions: ids.map((id) => ({ app_user_id: String(id), ...stateFor(byUser.get(id), titles, now) })),
  };
}

module.exports = { page, stateFor, isLive };
