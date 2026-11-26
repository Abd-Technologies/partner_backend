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

async function claimFor(user) {
  const tail = last10(user && user.phone);
  if (!user || !user.id || tail.length !== 10) return { claimed: 0, started: 0 };
  const { MagicPaymentLink, PlanImage } = require("../models");
  const links = await MagicPaymentLink.findAll({
    where: {
      UserId: null,
      status: "redeemed",
      redeemedPlanImageId: { [Op.ne]: null },
      phone: { [Op.ne]: null },
    },
    order: [["redeemedAt", "ASC"]],
  });
  let claimed = 0;
  let started = 0;
  for (const link of links.filter((l) => last10(l.phone) === tail)) {
    const img = await PlanImage.findOne({ where: { id: link.redeemedPlanImageId, UserId: null } });
    if (!img) continue;
    // Claim it (once): another process may be doing the same right now.
    const [n] = await PlanImage.update({ UserId: user.id }, { where: { id: img.id, UserId: null } });
    if (!n) continue;
    claimed++;
    link.UserId = user.id;
    await link.save();
    img.UserId = user.id;
    const d = img.ocrData && typeof img.ocrData === "object" ? img.ocrData : {};
    if (img.status === true && d.waitingForSignup === true) {
      const { applyPlanApproval } = require("./applyPlanApproval");
      const r = await applyPlanApproval(img, { approvalSource: d.approvedByAdmin ? "admin" : "auto" });
      if (r.ok) started++;
      else console.error(`[paymentClaims] slip ${img.id} for user ${user.id}: ${r.error}`);
    } else if (img.status === true) {
      // Still waiting for an admin: now it has a name on it.
      require("./paymentVerify").notifySlipForReview(img, "She just signed up — slip waiting for approval").catch(() => {});
    }
    console.log(`💳 [paymentClaims] slip ${img.id} → user ${user.id}${started ? " (plan started)" : ""}`);
  }
  return { claimed, started };
}

/** User afterCreate: run after the signup is committed, never fail it. */
function onUserCreated(user, options) {
  const run = () => claimFor(user).catch((e) => console.error("[paymentClaims]", e.message));
  const t = options && options.transaction;
  if (t && typeof t.afterCommit === "function") t.afterCommit(run);
  else setImmediate(run);
}

module.exports = { claimFor, onUserCreated, last10 };
