/**
 * crmEvents.js — tell the FitHer CRM about business moments (Nov 2026).
 *
 * emit() never sends anything itself. It saves the event in the CrmOutbox
 * table (inside the caller's DB transaction when one is passed, so the event
 * exists if and only if the change was saved). helper/crmOutboxSender.js
 * then delivers it, signed, and retries until the CRM confirms.
 *
 * Every event carries who she is (app_user_id, phone, email, name, and
 * crm_lead_id once Users.crmLeadId exists) plus occurred_at, so the CRM can
 * match her and ignore events that arrive out of order.
 *
 * registerHooks() wires the moments through model hooks, so every code path
 * is covered without touching the business logic:
 *   Users.afterCreate          → user_signup (with onboarding_done / onboarding_step)
 *   Users.afterUpdate          → onboarding_completed (finished the sign-up questions)
 *   PlanPurchases.afterCreate  → subscription_started / subscription_renewed
 *   TrialJourneys.afterCreate  → trial_started
 *   UserPlans.afterUpdate      → subscription_expired / _frozen / _unfrozen
 *                                (and cancelled → subscription_expired, reason "cancelled")
 * trial_ended is emitted from helper/freeTrialExpiry.js (bulk delete, no hook).
 * onboarding_stalled comes from reportStalledSignups() (hourly cron): she
 * made an account 20 h – 7 days ago and stopped before the last question.
 *
 * ⚠️  Hooks only see changes made through Sequelize INSTANCE saves inside the
 * main server (app.js). A bulk Model.update()/destroy() or a change made by a
 * script or notificationWorker.js is NOT seen. If you add such a path for
 * users, plans or payments, call emit() there yourself.
 *
 * Off when CRM_WEBHOOK_URL or APP_WEBHOOK_SECRET is missing, or when
 * CRM_EVENTS_ENABLED=false. Never throws: a CRM problem must never break a
 * signup or a payment.
 */
const crypto = require("crypto");

const USER_ATTRS = [
  "id", "firstName", "lastName", "email", "phone", "timeZone", "mainGoal", "healthConditions",
  "userType", "signupSource", "signupCampaign", "signupMethod",
  "onboardingStep", "onboardingDoneAt", "age", "height", "weight", "bmiResult",
];
// The sign-up questions have 6 pages (helper/onboardingReminder.js uses the same number).
const ONBOARDING_STEPS = 6;

function models() {
  return require("../models");
}

function enabled() {
  return (
    !!process.env.CRM_WEBHOOK_URL &&
    !!process.env.APP_WEBHOOK_SECRET &&
    String(process.env.CRM_EVENTS_ENABLED || "true").toLowerCase() !== "false"
  );
}

function identity(user) {
  const u = user && user.get ? user.get({ plain: true }) : user || {};
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || null;
  const conditions = String(u.healthConditions || "").toLowerCase();
  const out = {
    app_user_id: String(u.id),
    phone: u.phone || null,
    email: u.email || null,
    name,
    firstName: u.firstName || null,
    lastName: u.lastName || null,
    timezone: u.timeZone || null,
    mainGoal: u.mainGoal || null,
    has_pcos: conditions.includes("pcos") || conditions.includes("pcod"),
    signup_source: u.signupSource || null,
    signup_campaign: u.signupCampaign || null,
  };
  // Step 3 of the roadmap adds Users.crmLeadId; sent automatically once it exists.
  if (u.crmLeadId !== undefined) out.crm_lead_id = u.crmLeadId || null;
  return out;
}

/**
 * emit(eventType, userOrId, data, opts)
 * @param {string} eventType   e.g. "subscription_started"
 * @param {object|number} userOrId  User instance / plain object, or user id
 * @param {object} [data]      event fields (merged into the payload)
 * @param {object} [opts]
 *   transaction  Sequelize transaction to write in (recommended)
 *   key          stable id for this moment, e.g. "purchase-123". Emitting the
 *                same type+key twice is a no-op, and the CRM dedupes on it.
 *   occurredAt   when it happened (default now)
 * @returns {Promise<string|null>} eventId, or null when skipped
 */
async function emit(eventType, userOrId, data = {}, opts = {}) {
  if (!enabled()) return null;
  try {
    const { CrmOutbox, User } = models();
    const transaction = opts.transaction || undefined;
    let user = userOrId;
    if (user == null) return null;
    if (typeof user !== "object") {
      user = await User.findByPk(user, { attributes: USER_ATTRS, transaction });
      if (!user) return null;
    }
    const occurredAt = opts.occurredAt ? new Date(opts.occurredAt) : new Date();
    const eventId = opts.key ? `${eventType}:${opts.key}` : `${eventType}:${crypto.randomUUID()}`;
    const payload = { ...identity(user), ...data, occurred_at: occurredAt.toISOString() };

    await CrmOutbox.create(
      {
        eventId,
        eventType,
        userId: Number(payload.app_user_id) || null,
        payload,
        occurredAt,
        status: "pending",
        nextAttemptAt: new Date(),
      },
      { transaction }
    );
    return eventId;
  } catch (err) {
    if (err && err.name === "SequelizeUniqueConstraintError") return null; // same moment already queued
    console.error(`[crm-events] emit ${eventType} failed:`, err.message);
    return null;
  }
}

function onboardingAnswers(user) {
  return {
    main_goal: user.mainGoal || null,
    health_conditions: user.healthConditions || null,
    age: user.age || null,
    height: user.height || null,
    weight: user.weight || null,
    bmi: user.bmiResult || null,
    onboarding_step: ONBOARDING_STEPS,
    onboarding_steps_total: ONBOARDING_STEPS,
  };
}

/**
 * reportStalledSignups — hourly. Women who made an account 20 h to 7 days
 * ago, have no paid plan and stopped before the last sign-up question.
 * One onboarding_stalled event per woman (the outbox key makes repeats a
 * no-op). Tells the CRM where she stopped and whether the app can still
 * reach her by push.
 */
async function reportStalledSignups() {
  if (!enabled()) return 0;
  const { User, Sequelize } = models();
  const { Op } = Sequelize;
  const now = Date.now();
  const HOUR = 3600 * 1000;
  try {
    const users = await User.findAll({
      where: {
        userType: "User",
        status: { [Op.not]: true },
        onboardingDoneAt: null,
        createdAt: { [Op.gte]: new Date(now - 7 * 24 * HOUR), [Op.lte]: new Date(now - 20 * HOUR) },
        id: {
          [Op.notIn]: Sequelize.literal(
            "(SELECT userId FROM `CrmOutbox` WHERE eventType = 'onboarding_stalled' AND userId IS NOT NULL)"
          ),
        },
      },
      attributes: [...USER_ATTRS, "createdAt", "deviceToken", "onboardingReminderAt"],
      limit: 1000,
    });
    let n = 0;
    for (const u of users) {
      const step = u.onboardingStep || 0;
      const id = await emit("onboarding_stalled", u, {
        onboarding_step: step,
        onboarding_steps_total: ONBOARDING_STEPS,
        steps_left: Math.max(1, ONBOARDING_STEPS - step),
        signed_up_at: new Date(u.createdAt).toISOString(),
        can_push: !!(u.deviceToken && String(u.deviceToken).trim()),
        app_reminder_sent_at: u.onboardingReminderAt ? new Date(u.onboardingReminderAt).toISOString() : null,
      }, { key: `stalled-${u.id}` });
      if (id) n++;
    }
    if (n) console.log(`[crm-events] onboarding_stalled queued for ${n} women`);
    return n;
  } catch (err) {
    console.error("[crm-events] reportStalledSignups failed:", err.message);
    return 0;
  }
}

// Trial plans: new ones have isTrial=true; legacy admin "assignFreePlan"
// rows use the plan titled "Free Trial" with no flag. Cached for 10 min.
let _freePlanIds = { at: 0, ids: [] };
async function freeTrialPlanIds() {
  if (Date.now() - _freePlanIds.at < 10 * 60 * 1000) return _freePlanIds.ids;
  try {
    const { Plan } = models();
    const rows = await Plan.findAll({ where: { title: "Free Trial" }, attributes: ["id"] });
    _freePlanIds = { at: Date.now(), ids: rows.map((r) => r.id) };
  } catch (_) {}
  return _freePlanIds.ids;
}
async function isTrialPlan(userPlan) {
  if (!userPlan) return false;
  if (userPlan.isTrial) return true;
  return (await freeTrialPlanIds()).includes(userPlan.PlanId);
}

/**
 * planStarted — for the paid-plan paths that DON'T go through the purchase
 * ledger (Stripe, admin "payment success", admin adds a user with a plan).
 * Same event the ledger sends, keyed on the UserPlan so it's sent once.
 */
async function planStarted(userPlan, source, { amount = null } = {}) {
  if (!userPlan || !userPlan.userId) return null;
  if (await isTrialPlan(userPlan)) return null;
  let title = null;
  try {
    const p = userPlan.PlanId ? await models().Plan.findByPk(userPlan.PlanId, { attributes: ["title"] }) : null;
    title = p ? p.title : null;
  } catch (_) {}
  return emit("subscription_started", userPlan.userId, {
    user_plan_id: userPlan.id,
    plan_id: userPlan.PlanId || null,
    plan_title: title,
    amount: amount != null ? amount : Number(userPlan.price) || null,
    currency: "PKR",
    method: source,
    started_at: new Date(userPlan.buyingDate || Date.now()).toISOString(),
    expires_at: userPlan.expireDate ? new Date(userPlan.expireDate).toISOString() : null,
  }, { key: `userplan-${userPlan.id}`, occurredAt: userPlan.buyingDate || new Date() });
}

/** trialPlanStarted — legacy admin "assign free plan" (no TrialJourney). */
async function trialPlanStarted(userPlan) {
  if (!userPlan || !userPlan.userId) return null;
  return emit("trial_started", userPlan.userId, {
    user_plan_id: userPlan.id,
    via_trial_link: false,
    started_at: new Date(userPlan.buyingDate || Date.now()).toISOString(),
    legacy_free_plan: true,
  }, { key: `trialplan-${userPlan.id}`, occurredAt: userPlan.buyingDate || new Date() });
}

// ── Model hooks ─────────────────────────────────────────────────────────
let hooksRegistered = false;

function ts(d) {
  const t = d ? new Date(d).getTime() : NaN;
  return Number.isFinite(t) ? t : "na";
}

function registerHooks(db = models()) {
  if (hooksRegistered) return;
  hooksRegistered = true;
  const userType = process.env.USER || "User";

  // 1. Signup — every path that creates a client account.
  db.User.addHook("afterCreate", "crmEvents.signup", async (user, options) => {
    if (user.userType && user.userType !== userType && user.userType !== "User") return;
    await emit("user_signup", user, {
      signup_method: user.signupMethod || null,
      onboarding_done: !!user.onboardingDoneAt,
      onboarding_step: user.onboardingStep || 0,
      onboarding_steps_total: ONBOARDING_STEPS,
    }, {
      transaction: options.transaction,
      key: `user-${user.id}`,
      occurredAt: user.createdAt,
    });
  });

  // 1b. Finished the sign-up questions (first time only).
  db.User.addHook("afterUpdate", "crmEvents.onboarding", async (user, options) => {
    if (!user.changed("onboardingDoneAt") || !user.onboardingDoneAt || user.previous("onboardingDoneAt")) return;
    if (user.userType && user.userType !== "User" && user.userType !== userType) return;
    await emit("onboarding_completed", user, onboardingAnswers(user), {
      transaction: options.transaction,
      key: `onboarding-${user.id}`,
      occurredAt: user.onboardingDoneAt,
    });
  });

  // 2. Payment approved — the purchase ledger has exactly one row per
  //    approved payment (slip, auto/OCR, magic link, admin, rep).
  if (db.PlanPurchase) {
    db.PlanPurchase.addHook("afterCreate", "crmEvents.purchase", async (p, options) => {
      let expiresAt = null;
      try {
        if (p.userPlanId && db.UserPlan) {
          const up = await db.UserPlan.findByPk(p.userPlanId, { attributes: ["expireDate"], transaction: options.transaction });
          expiresAt = up && up.expireDate ? new Date(up.expireDate).toISOString() : null;
        }
      } catch (_) {}
      const type = p.kind === "renew" ? "subscription_renewed" : "subscription_started";
      await emit(type, p.userId, {
        purchase_id: p.id,
        plan_id: p.planId,
        plan_title: p.planTitle,
        plan_type: p.planType,
        purchase_kind: p.kind,
        amount: p.amount,
        list_price: p.listPrice,
        discount_amount: p.discountAmount,
        currency: "PKR",
        days: p.days,
        plan_duration_months: p.days ? Math.max(1, Math.round(p.days / 30)) : null,
        method: p.method,
        approved_by: p.approvedBy,
        app_sales_rep_id: p.salesRepId || null,
        started_at: new Date(p.purchasedAt || Date.now()).toISOString(),
        expires_at: expiresAt,
      }, {
        transaction: options.transaction,
        key: `purchase-${p.id}`,
        occurredAt: p.purchasedAt,
      });
    });
  }

  // 3. Trial started.
  if (db.TrialJourney) {
    db.TrialJourney.addHook("afterCreate", "crmEvents.trialStarted", async (j, options) => {
      if (!j.userId) return;
      await emit("trial_started", j.userId, {
        trial_journey_id: j.id,
        via_trial_link: !!j.trialTokenId,
        started_at: new Date(j.startedAt || j.createdAt || Date.now()).toISOString(),
      }, {
        transaction: options.transaction,
        key: `trial-${j.id}`,
        occurredAt: j.startedAt || j.createdAt,
      });
    });
  }

  // 4. Plan expired / frozen / unfrozen / cancelled (paid plans only;
  //    trials have their own events). Sequelize runs afterUpdate before it
  //    resets changed()/previous(), so both are reliable here.
  if (db.UserPlan) {
    db.UserPlan.addHook("afterUpdate", "crmEvents.planChange", async (plan, options) => {
      if (await isTrialPlan(plan)) return;
      const base = {
        user_plan_id: plan.id,
        plan_id: plan.PlanId || null,
        expires_at: plan.expireDate ? new Date(plan.expireDate).toISOString() : null,
      };
      const tx = { transaction: options.transaction };

      if (plan.changed("planStatus") && plan.planStatus === "expired") {
        await emit("subscription_expired", plan.userId, { ...base, reason: "expired" },
          { ...tx, key: `plan-${plan.id}-expired-${ts(plan.expireDate)}` });
      }
      if (plan.changed("cancelledAt") && plan.cancelledAt && !plan.previous("cancelledAt")) {
        await emit("subscription_expired", plan.userId, { ...base, reason: "cancelled" },
          { ...tx, key: `plan-${plan.id}-cancelled-${ts(plan.cancelledAt)}`, occurredAt: plan.cancelledAt });
      }
      if (plan.changed("frozenAt")) {
        const before = plan.previous("frozenAt");
        if (!before && plan.frozenAt) {
          await emit("subscription_frozen", plan.userId, { ...base, freeze_days: plan.freezeDays || null },
            { ...tx, key: `plan-${plan.id}-frozen-${ts(plan.frozenAt)}`, occurredAt: plan.frozenAt });
        } else if (before && !plan.frozenAt) {
          await emit("subscription_unfrozen", plan.userId, base,
            { ...tx, key: `plan-${plan.id}-unfrozen-${ts(before)}` });
        }
      }
    });
  }

  console.log(`🔗 CRM events: ${enabled() ? "ON → " + process.env.CRM_WEBHOOK_URL : "OFF (CRM_WEBHOOK_URL / APP_WEBHOOK_SECRET not set)"}`);
}

module.exports = { emit, registerHooks, enabled, identity, reportStalledSignups, planStarted, trialPlanStarted, isTrialPlan, ONBOARDING_STEPS };
