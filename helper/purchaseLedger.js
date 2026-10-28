// Purchase history + payment attempts (models/PlanPurchase.js,
// models/PaymentAttempt.js). Add-on: never throws, never changes a flow.
//
//   slipCreated(planImage)                  → attempt "pending"   (PlanImage afterCreate hook)
//   slipRejected(planImage, adminId)        → attempt "rejected"  (before the slip is deleted)
//   purchased({ planImage, userPlanId, approvedBy, approvedById })
//                                           → attempt "approved" + one PlanPurchase row
//                                             + Mixpanel "Purchase" (server side)
//   directPayStarted({...})                 → attempt "initiated"
const { Op } = require("sequelize");
const models = () => require("../models");

// DirectPay payments (AdminController.payment_success) are PlanImage rows
// with no slip and ocrData.method = "directpay".
function isDirectPay(img) {
  let d = img && img.ocrData;
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch (_) { d = null; }
  }
  return !!(d && d.method === "directpay");
}

const methodOf = (img) =>
  isDirectPay(img) ? "directpay" : img && img.uploadSource === "magic_link" ? "magic_link" : img && img.uploadSource === "rep_crm" ? "rep_crm" : "slip";

async function slipCreated(img) {
  try {
    // DirectPay: its "initiated" attempt is moved to pending + linked by
    // payment_success itself, so don't add a second attempt here.
    if (isDirectPay(img)) return;
    const { PaymentAttempt } = models();
    await PaymentAttempt.create({
      userId: img.UserId || null,
      planId: img.PlanId || null,
      durationId: img.PriceDurationId || null,
      amount: img.paidAmount || Number(img.price) || null,
      method: methodOf(img),
      status: "pending",
      planImageId: img.id,
    });
  } catch (e) {
    console.error("[ledger] slipCreated:", e.message);
  }
}

async function decide(planImageId, status, adminId = null) {
  const { PaymentAttempt } = models();
  const row = await PaymentAttempt.findOne({ where: { planImageId }, order: [["id", "DESC"]] });
  if (row) {
    row.status = status;
    row.decidedAt = new Date();
    row.decidedById = adminId;
    await row.save();
  }
  return row;
}

async function slipRejected(img, adminId) {
  try {
    if (img) await decide(img.id, "rejected", adminId);
  } catch (e) {
    console.error("[ledger] slipRejected:", e.message);
  }
}

/** new / renewal / upgrade / switch, compared with her previous purchase. */
async function kindFor(userId, planType) {
  const { PlanPurchase, UserPlan, Plan } = models();
  const prev = await PlanPurchase.findOne({ where: { userId }, order: [["purchasedAt", "DESC"]] });
  let prevType = prev ? prev.planType : null;
  if (!prev) {
    // Before this history existed: any earlier non-trial plan = not new.
    const legacy = await UserPlan.findOne({
      where: { userId, isTrial: { [Op.not]: true } },
      include: [{ model: Plan, attributes: ["planType", "title"] }],
      order: [["createdAt", "ASC"]],
    });
    const title = legacy && legacy.Plan ? String(legacy.Plan.title || "") : "";
    const isTrialPlan = /free trial|system/i.test(title);
    if (!legacy || isTrialPlan) return { kind: "new", previousPlanType: null };
    prevType = legacy.Plan ? legacy.Plan.planType : null;
  }
  if (!prevType || !planType || prevType === planType) return { kind: "renewal", previousPlanType: prevType };
  if (planType === "combined") return { kind: "upgrade", previousPlanType: prevType };
  return { kind: "switch", previousPlanType: prevType };
}

async function purchased({ planImage, userPlanId = null, approvedBy = "admin", approvedById = null }) {
  try {
    const { PlanPurchase, Plan, PriceDurations } = models();
    const img = planImage;
    if (!img || !img.UserId) return;
    // One purchase per slip, even if approval runs twice.
    if (await PlanPurchase.findOne({ where: { planImageId: img.id } })) return;
    const plan = img.PlanId ? await Plan.findByPk(img.PlanId, { attributes: ["id", "title", "planType"] }) : null;
    let days = null;
    try {
      const d = img.PriceDurationId && PriceDurations ? await PriceDurations.findByPk(img.PriceDurationId) : null;
      const m = d && String(d.duration || "").match(/\d+/);
      days = m ? parseInt(m[0], 10) : null;
    } catch (_) {}
    const planType = plan ? plan.planType || null : null;
    const { kind, previousPlanType } = await kindFor(img.UserId, planType);
    const amount = img.paidAmount || Number(img.price) || null;
    const row = await PlanPurchase.create({
      userId: img.UserId,
      planId: img.PlanId || null,
      planTitle: plan ? plan.title : null,
      planType,
      userPlanId,
      kind,
      previousPlanType,
      amount,
      listPrice: img.listPrice || null,
      discountAmount: img.discountAmount || null,
      days,
      method: methodOf(img),
      approvedBy,
      approvedById,
      planImageId: img.id,
      salesRepId: img.uploadedByRepId || null,
      purchasedAt: new Date(),
    });
    await decide(img.id, "approved", approvedById);
    require("./mixpanelServer").track(img.UserId, "Purchase", {
      insert_key: `img${img.id}`,
      plan_type: planType,
      plan_title: plan ? plan.title : null,
      kind,
      amount,
      currency: "PKR",
      days,
      method: row.method,
      approved_by: approvedBy,
    });
  } catch (e) {
    console.error("[ledger] purchased:", e.message);
  }
}

async function directPayStarted({ userId, planId, amount, ref, durationId = null }) {
  try {
    const { PaymentAttempt } = models();
    await PaymentAttempt.create({
      userId: userId || null,
      planId: planId || null,
      durationId: durationId || null,
      amount: Number(amount) || null,
      method: "directpay",
      status: "initiated",
      ref: ref ? String(ref).slice(0, 80) : null,
    });
  } catch (e) {
    console.error("[ledger] directPayStarted:", e.message);
  }
}

module.exports = { slipCreated, slipRejected, purchased, directPayStarted, kindFor, isDirectPay };
