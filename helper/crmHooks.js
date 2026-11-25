// CRM hooks (Nov 2026): turn model changes into CRM events, from ONE place,
// so every path is covered (app sign-up, admin "add user", web sign-up,
// user / admin / cron freeze, hourly expiry, cancel...). Wired in
// models/User.js and models/UserPlan.js. Sends only after the database
// transaction commits, so a rolled-back change never reaches the CRM.
// Never throws. helper/crmEvents.js does the queueing + sending.
const { Op } = require("sequelize");
const crm = () => require("./crmEvents");
const models = () => require("../models");

function afterCommit(options, fn) {
  const run = () => Promise.resolve().then(fn).catch((e) => console.error("[crmHooks]", e.message));
  const t = options && options.transaction;
  if (t && typeof t.afterCommit === "function") t.afterCommit(run);
  else setImmediate(run);
}

const isCustomer = (u) => String((u && u.userType) || "").trim().toLowerCase() === "user";
const fullName = (u) => [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
const ms = (d) => (d ? new Date(d).getTime() : 0);

function who(u) {
  return {
    app_user_id: u.id,
    name: fullName(u),
    email: u.email || null,
    phone: u.phone || null,
  };
}

// ── User ──────────────────────────────────────────────────────
function userCreated(user, options) {
  if (!isCustomer(user)) return;
  afterCommit(options, () =>
    crm().emit("user_signup", {
      ...who(user),
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      timezone: user.timeZone || null,
      mainGoal: user.mainGoal || null,
      onboarding_done: !!user.onboardingDoneAt,
      signup_source: user.signupSource || null,
      // Signed ref from the rep's signup link (CRM checks it): links her to
      // her WhatsApp lead whatever phone she typed.
      crm_ref: user._crmRef || null,
    }, `user-${user.id}-signup`)
  );
}

function userUpdated(user, options) {
  if (!isCustomer(user)) return;
  // Finished the sign-up questions.
  if (user.changed("onboardingDoneAt") && !user.previous("onboardingDoneAt") && user.onboardingDoneAt) {
    afterCommit(options, () =>
      crm().emit("onboarding_completed", {
        ...who(user),
        main_goal: user.mainGoal || null,
        health_conditions: user.healthConditions || null,
        age: user.age || null,
        weight: user.weight || null,
        height: user.height || null,
      }, `user-${user.id}-onboarded`)
    );
  }
  // Name / email / phone changed: a phone added later lets the CRM match
  // her to her WhatsApp conversation.
  const keys = ["firstName", "lastName", "email", "phone", "timeZone"].filter((k) => user.changed(k));
  if (keys.length) {
    const p = { app_user_id: user.id };
    if (keys.includes("firstName") || keys.includes("lastName")) p.name = fullName(user);
    if (keys.includes("email") && user.email) p.email = user.email;
    if (keys.includes("phone") && user.phone) p.phone = user.phone;
    if (keys.includes("timeZone") && user.timeZone) p.timezone = user.timeZone;
    if (Object.keys(p).length > 1) {
      afterCommit(options, () => crm().emit("profile_updated", p, `user-${user.id}-profile-${Date.now()}`));
    }
  }
}

// ── UserPlan ──────────────────────────────────────────────────
async function planInfo(plan) {
  const { Plan, User } = models();
  const [p, u] = await Promise.all([
    plan.PlanId ? Plan.findByPk(plan.PlanId, { attributes: ["id", "title"] }) : null,
    User.findByPk(plan.userId, { attributes: ["id", "firstName", "lastName", "email", "phone", "userType"] }),
  ]);
  return { plan: p, user: u };
}

/** Does she still have another live paid plan? Then nothing "ended". */
async function hasOtherPaidPlan(plan) {
  const { UserPlan } = models();
  const other = await UserPlan.findOne({
    where: {
      userId: plan.userId,
      id: { [Op.ne]: plan.id },
      status: true,
      isTrial: { [Op.not]: true },
      cancelledAt: null,
      expireDate: { [Op.gt]: new Date() },
      [Op.or]: [{ planStatus: null }, { planStatus: { [Op.notIn]: ["expired", "cancelled", "completed"] } }],
    },
    attributes: ["id"],
  });
  return !!other;
}

function planCreated(plan, options) {
  if (!plan.isTrial) return; // paid plans are sent by helper/purchaseLedger.js
  afterCommit(options, async () => {
    const { plan: p, user } = await planInfo(plan);
    if (!user || !isCustomer(user)) return;
    await crm().emit("trial_started", {
      ...who(user),
      plan_id: plan.PlanId || null,
      plan_title: p ? p.title : null,
      started_at: plan.buyingDate || new Date(),
      expires_at: plan.expireDate || null,
    }, `plan-${plan.id}-trial-started`);
  });
}

function planUpdated(plan, options) {
  const events = [];
  if (plan.changed("frozenAt") && !plan.isTrial) {
    const before = plan.previous("frozenAt");
    if (!before && plan.frozenAt) {
      const until = plan.freezeDays ? new Date(ms(plan.frozenAt) + plan.freezeDays * 86400000) : null;
      events.push(["subscription_frozen", { frozen_at: plan.frozenAt, frozen_until: until, freeze_days: plan.freezeDays || null }, `plan-${plan.id}-frozen-${ms(plan.frozenAt)}`]);
    } else if (before && !plan.frozenAt) {
      events.push(["subscription_unfrozen", { new_expires_at: plan.expireDate || null }, `plan-${plan.id}-unfrozen-${ms(before)}`]);
    }
  }
  if (plan.changed("planStatus") && ["expired", "cancelled"].includes(plan.planStatus)) {
    if (plan.isTrial) {
      if (plan.planStatus === "expired") events.push(["trial_ended", {}, `plan-${plan.id}-trial-ended`]);
    } else {
      events.push(["subscription_expired", { reason: plan.planStatus, expired_at: plan.expireDate || null, _checkOther: true },
        `plan-${plan.id}-${plan.planStatus}-${ms(plan.expireDate)}`]);
    }
  }
  if (!events.length) return;

  afterCommit(options, async () => {
    const { plan: p, user } = await planInfo(plan);
    if (!user || !isCustomer(user)) return;
    for (const [type, extra, id] of events) {
      const { _checkOther, ...rest } = extra;
      // Old plan ran out but she renewed onto another one: not an ending.
      if (_checkOther && (await hasOtherPaidPlan(plan))) continue;
      await crm().emit(type, { ...who(user), plan_id: plan.PlanId || null, plan_title: p ? p.title : null, ...rest }, id);
    }
  });
}

// ── Purchases (called from helper/purchaseLedger.js purchased()) ──
async function purchased(row, img) {
  try {
    const { UserPlan, User } = models();
    const [user, up] = await Promise.all([
      User.findByPk(row.userId, { attributes: ["id", "firstName", "lastName", "email", "phone", "userType"] }),
      row.userPlanId ? UserPlan.findByPk(row.userPlanId, { attributes: ["id", "buyingDate", "expireDate"] }) : null,
    ]);
    if (!user) return;
    await crm().emit("subscription_started", {
      ...who(user),
      plan_id: row.planId || null,
      plan_title: row.planTitle || null,
      plan_type: row.planType || null,
      kind: row.kind, // new / renewal / upgrade / switch
      amount: row.amount || 0,
      currency: "PKR",
      days: row.days || null,
      plan_duration_months: row.days ? Math.max(1, Math.round(row.days / 30)) : null,
      method: row.method || null,
      started_at: (up && up.buyingDate) || row.purchasedAt,
      expires_at: (up && up.expireDate) || null,
      sales_rep_partner_id: row.salesRepId || null,
    }, `purchase-${row.id}`);
  } catch (e) {
    console.error("[crmHooks] purchased:", e.message);
  }
}

/** Slip / payment rejected by the team. */
async function paymentRejected(img, adminId) {
  try {
    if (!img || !img.UserId) return;
    const { User, Plan } = models();
    const [user, p] = await Promise.all([
      User.findByPk(img.UserId, { attributes: ["id", "firstName", "lastName", "email", "phone", "userType"] }),
      img.PlanId ? Plan.findByPk(img.PlanId, { attributes: ["id", "title"] }) : null,
    ]);
    if (!user || !isCustomer(user)) return;
    await crm().emit("payment_failed", {
      ...who(user),
      plan_id: img.PlanId || null,
      plan_title: p ? p.title : null,
      amount: img.paidAmount || Number(img.price) || null,
      currency: "PKR",
      reason: "slip_rejected",
    }, `slip-${img.id}-rejected`);
  } catch (e) {
    console.error("[crmHooks] paymentRejected:", e.message);
  }
}

// ── She used the app today (once a day per woman) ─────────────
// Called on every signed-in app request (helper/authToken.js verifyAccess),
// so it must be cheap and never throw. Sends "user_login" to the CRM at most
// once per woman per Pakistan day: an in-memory note stops repeats in this
// process, and the outbox key user-<id>-active-<day> stops repeats across
// processes. The CRM records her as active and, if it has never heard of her
// (an app user from before the CRM), creates her lead.
const seenToday = new Map(); // userId -> "YYYY-MM-DD" (PKT)
const pktDay = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);

function dailyActive(user) {
  try {
    if (!user || !isCustomer(user)) return;
    const day = pktDay();
    const key = String(user.id);
    if (seenToday.get(key) === day) return;
    seenToday.set(key, day);
    if (seenToday.size > 50000) for (const [k, d] of seenToday) if (d !== day) seenToday.delete(k);
    setImmediate(async () => {
      try {
        const { User } = require("../models");
        const u = await User.findOne({
          where: { id: user.id },
          attributes: ["id", "email", "phone", "firstName", "lastName", "timeZone", "userType"],
          raw: true,
        });
        if (!u) return;
        await crm().emit("user_login", { ...who(u), timezone: u.timeZone || null, active_day: day }, `user-${u.id}-active-${day}`);
      } catch (e) {
        console.warn("[crmHooks] dailyActive:", e.message);
      }
    });
  } catch (_) { /* never break a request over this */ }
}

module.exports = { userCreated, userUpdated, planCreated, planUpdated, purchased, paymentRejected, dailyActive };
