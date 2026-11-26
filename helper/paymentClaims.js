/**
 * paymentClaims.js — a payment made before she had an app account (Nov 2026).
 *
 * On WhatsApp she pays and sends the slip; the CRM passes it to
 * magicLinkController.redeemWithSlip. If she has no app account yet the slip
 * is saved with no user: approved-and-waiting (it passed every check, or an
 * admin approved it) or waiting for review. This attaches those slips to her
 * the moment we know who she is, and starts the plan if it was approved:
 *   - she signs up (User afterCreate, models/User.js)
 *   - an existing app user opens the app (once a day, helper/crmHooks.dailyActive)
 * Matched on the phone the rep's payment request was made for (last 10
 * digits) — her CRM lead's WhatsApp number.
 */
const { Op } = require("sequelize");

const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);

const normEmail = (e) => String(e || "").trim().toLowerCase();
const starting = new Set(); // slip ids being started right now (this process)

async function claimFor(user) {
  const tail = last10(user && user.phone);
  const email = normEmail(user && user.email);
  if (!user || !user.id || (tail.length !== 10 && !email.includes("@"))) return { claimed: 0, started: 0 };
  const { MagicPaymentLink, PlanImage } = require("../models");
  const links = await MagicPaymentLink.findAll({
    where: {
      status: "redeemed",
      redeemedPlanImageId: { [Op.ne]: null },
      [Op.or]: [
        // Not claimed yet: hers if the request's phone OR email matches.
        { UserId: null, [Op.or]: [{ phone: { [Op.ne]: null } }, { email: { [Op.ne]: null } }] },
        // Already hers but the plan may not have started (recovery).
        { UserId: user.id },
      ],
    },
    order: [["redeemedAt", "ASC"]],
  });
  const isHers = (l) =>
    Number(l.UserId) === Number(user.id) ||
    (tail.length === 10 && last10(l.phone) === tail) ||
    (email.includes("@") && normEmail(l.email) === email);
  let claimed = 0;
  let started = 0;
  for (const link of links.filter(isHers)) {
    const img = await PlanImage.findOne({
      where: { id: link.redeemedPlanImageId, [Op.or]: [{ UserId: null }, { UserId: user.id }] },
    });
    if (!img) continue;
    if (!img.UserId) {
      // Claim it (once): another process may be doing the same right now.
      const [n] = await PlanImage.update({ UserId: user.id }, { where: { id: img.id, UserId: null } });
      if (!n) continue;
      claimed++;
      img.UserId = user.id;
    }
    if (!link.UserId) { link.UserId = user.id; await link.save(); }

    const d = img.ocrData && typeof img.ocrData === "object" ? img.ocrData : {};
    if (img.status === true && d.waitingForSignup === true && !d.planStartedAt) {
      // One start per slip: starting twice would EXTEND her plan twice.
      if (starting.has(img.id)) continue;
      starting.add(img.id);
      try {
        const fresh = await PlanImage.findByPk(img.id);
        const fd = fresh && fresh.ocrData && typeof fresh.ocrData === "object" ? fresh.ocrData : {};
        if (!fresh || fd.planStartedAt || fd.waitingForSignup !== true) continue;
        const { applyPlanApproval } = require("./applyPlanApproval");
        const r = await applyPlanApproval(fresh, { approvalSource: fd.approvedByAdmin ? "admin" : "auto" });
        if (r.ok) {
          started++;
          fresh.ocrData = { ...fd, waitingForSignup: false, planStartedAt: new Date().toISOString() };
          fresh.changed("ocrData", true);
          await fresh.save();
        } else {
          console.error(`[paymentClaims] slip ${img.id} for user ${user.id}: ${r.error}`);
        }
      } finally {
        starting.delete(img.id);
      }
    } else if (claimed && img.status === true && !d.planStartedAt && d.waitingForSignup !== true) {
      // Still waiting for an admin: now it has a name on it.
      require("./paymentVerify").notifySlipForReview(img, "She just signed up — slip waiting for approval").catch(() => {});
    }
    console.log(`💳 [paymentClaims] slip ${img.id} → user ${user.id}${started ? " (plan started)" : ""}`);
  }
  return { claimed, started };
}

/**
 * The app account a payment link belongs to, when there's exactly one:
 * phone (last 10 digits) or email. Ambiguous (two accounts share the
 * number) or none → null, and the slip waits for signup / the next login.
 */
async function findAccountFor(link) {
  try {
    const { User } = require("../models");
    const tail = last10(link && link.phone);
    const email = normEmail(link && link.email);
    const either = [];
    if (tail.length === 10) either.push({ phone: { [Op.like]: `%${tail}` } });
    if (email.includes("@")) either.push({ email });
    if (!either.length) return null;
    const users = await User.findAll({
      where: { [Op.or]: either, userType: { [Op.in]: ["User", "user"] } },
      attributes: ["id", "phone", "email"],
      limit: 3,
    });
    const hits = users.filter((u) =>
      (tail.length === 10 && last10(u.phone) === tail) || (email.includes("@") && normEmail(u.email) === email));
    return hits.length === 1 ? hits[0].id : null;
  } catch (e) {
    console.error("[paymentClaims] findAccountFor:", e.message);
    return null;
  }
}

/** User afterCreate: run after the signup is committed, never fail it. */
function onUserCreated(user, options) {
  const run = () => claimFor(user).catch((e) => console.error("[paymentClaims]", e.message));
  const t = options && options.transaction;
  if (t && typeof t.afterCommit === "function") t.afterCommit(run);
  else setImmediate(run);
}

module.exports = { claimFor, onUserCreated, findAccountFor, last10 };
