// Payment check after an AI (auto) slip approval — Oct 2026.
//
// The AI reads the slip and starts her plan at once, but a slip can be
// edited, so a person must confirm the money really arrived:
//   • Admin gets reminders at 24 h and 40 h ("Confirm payments" list).
//   • Admin taps Received → done (and un-paused if it was paused).
//   • Admin taps Not received → paused at once.
//   • Not confirmed within 48 h → paused automatically.
// Paused = the days this slip paid for are taken off (a renewal keeps her
// earlier paid days; a new plan is switched off). She sees the free app
// with a red banner and can send proof. Received gives everything back,
// plus the days she was paused.
const { Op } = require("sequelize");
const sendNotification = require("./notification");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const HOLD_AFTER_HOURS = 48;
const REMINDERS_AT_HOURS = [24, 40];

const M = () => require("../models");

async function adminTokens() {
  const { User } = M();
  const admins = await User.findAll({
    where: { userType: { [Op.like]: "admin%" }, deviceToken: { [Op.ne]: null } },
    attributes: ["deviceToken"],
  });
  return admins.map((a) => a.deviceToken).filter(Boolean);
}

async function pushAdmins(title, body, data = { type: "paymentCheck" }) {
  try {
    const tokens = await adminTokens();
    if (tokens.length) await sendNotification(tokens, { title, body }, data);
  } catch (e) {
    console.warn("[payment-verify] admin push:", e.message);
  }
}

async function pushUser(userId, title, body, type) {
  try {
    const u = await M().User.findByPk(userId, { attributes: ["deviceToken"] });
    if (u && u.deviceToken) await sendNotification([u.deviceToken], { title, body }, { type });
  } catch (e) {
    console.warn("[payment-verify] user push:", e.message);
  }
}

/** She keeps "paid" only if another live paid plan exists. */
async function refreshPaidFlag(userId) {
  const { UserPlan, User } = M();
  // A paused-by-her (frozen) plan still counts as paid.
  const live = await UserPlan.count({
    where: { userId, status: true, cancelledAt: null, isTrial: { [Op.not]: true }, expireDate: { [Op.gte]: new Date() } },
  });
  await User.update({ status: live > 0 }, { where: { id: userId } });
}

// ── Consultations on hold (Oct 2026) ─────────────────────────────────
// While her payment is paused, an upcoming consultation that this
// payment covers is put on hold (Appointments.paymentHoldAt): it keeps
// its time, but can't be started, and no reminders / no-show rules run.
// Received → back to normal (or, if its time passed meanwhile, canceled
// so she rebooks; it doesn't use up her consultation).

async function holdAppointments(plan, image) {
  const { Appointment, User } = M();
  if (!plan) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await Appointment.findAll({
    where: {
      planId: plan.id,
      status: { [Op.in]: ["pending", "confirmed"] },
      paymentHoldAt: null,
      date: { [Op.gte]: today },
    },
  });
  // Renewal: her earlier paid days still cover sessions before the
  // (shortened) end date; only later ones go on hold.
  const coveredUntil = plan.status && plan.expireDate ? new Date(plan.expireDate).getTime() : 0;
  let n = 0;
  for (const a of rows) {
    if (coveredUntil && new Date(a.date).getTime() <= coveredUntil) continue;
    a.paymentHoldAt = new Date();
    await a.save();
    n++;
    try {
      const [client, dietitian] = await Promise.all([
        User.findByPk(a.userId, { attributes: ["firstName", "lastName"] }),
        User.findByPk(a.dietitionId, { attributes: ["deviceToken"] }),
      ]);
      const name = client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() : "A client";
      const when = new Date(a.date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Karachi" });
      if (dietitian && dietitian.deviceToken) {
        await sendNotification(
          [dietitian.deviceToken],
          { title: "Consultation on hold", body: `${name}'s consultation on ${when} is on hold until her payment is confirmed. Please don't start it.` },
          { type: "appointmentHold", appointmentId: String(a.id) }
        );
      }
    } catch (e) {
      console.warn("[payment-verify] dietitian push:", e.message);
    }
  }
  return n;
}

async function releaseAppointments(plan) {
  const { Appointment, User } = M();
  if (!plan) return;
  const rows = await Appointment.findAll({
    where: { planId: plan.id, paymentHoldAt: { [Op.ne]: null } },
  });
  const bookingPolicy = require("./bookingPolicy");
  for (const a of rows) {
    try {
      const start = await bookingPolicy.sessionStart(a);
      const passed = start && start.getTime() < Date.now();
      a.paymentHoldAt = null;
      if (passed && ["pending", "confirmed"].includes(a.status)) {
        // Its time went by while on hold: free it so she books a new one.
        a.status = "canceled";
        a.message = "Missed while the payment was on hold";
        a.status_changed_at = new Date();
      }
      await a.save();
      if (!passed) {
        const d = await User.findByPk(a.dietitionId, { attributes: ["deviceToken"] });
        if (d && d.deviceToken) {
          await sendNotification(
            [d.deviceToken],
            { title: "Consultation back on", body: "Payment confirmed: the consultation that was on hold goes ahead as booked." },
            { type: "appointmentHold", appointmentId: String(a.id) }
          );
        }
      }
    } catch (e) {
      console.warn("[payment-verify] release appointment:", e.message);
    }
  }
}

/** Pause what this slip paid for. reason: 'held' (48 h) | 'not_received'. */
async function hold(image, reason) {
  const { UserPlan } = M();
  if (image.heldAt) {
    image.verifyStatus = reason;
    await image.save();
    return;
  }
  const plan = image.verifyUserPlanId ? await UserPlan.findByPk(image.verifyUserPlanId) : null;
  if (plan) {
    if (image.verifyExtended) {
      // Renewal: take off only the days this slip added.
      const days = image.verifyDays || 0;
      plan.expireDate = new Date(new Date(plan.expireDate).getTime() - days * DAY);
    } else {
      plan.status = false;
    }
    await plan.save();
  }
  image.heldAt = new Date();
  image.verifyStatus = reason;
  await image.save();
  let held = 0;
  try {
    held = await holdAppointments(plan, image);
  } catch (e) {
    console.warn("[payment-verify] hold appointments:", e.message);
  }
  if (image.UserId) {
    await refreshPaidFlag(image.UserId);
    await pushUser(
      image.UserId,
      "We couldn't confirm your payment",
      held
        ? "Your plan and your consultation are on hold until we confirm it. Open Fit Her to send your proof."
        : "Your plan is paused until we confirm it. Open Fit Her to send your proof.",
      "paymentHold"
    );
  }
}

/** Admin: the money arrived. Un-pauses, adding back the paused days. */
async function confirm(image, adminId) {
  const { UserPlan } = M();
  if (image.heldAt) {
    const plan = image.verifyUserPlanId ? await UserPlan.findByPk(image.verifyUserPlanId) : null;
    if (plan) {
      const pausedMs = Date.now() - new Date(image.heldAt).getTime();
      if (image.verifyExtended) {
        plan.expireDate = new Date(new Date(plan.expireDate).getTime() + (image.verifyDays || 0) * DAY + pausedMs);
      } else {
        plan.status = true;
        plan.expireDate = new Date(new Date(plan.expireDate).getTime() + pausedMs);
      }
      await plan.save();
      try {
        await releaseAppointments(plan);
      } catch (e) {
        console.warn("[payment-verify] release appointments:", e.message);
      }
    }
    if (image.UserId) {
      await refreshPaidFlag(image.UserId);
      await pushUser(image.UserId, "Payment confirmed 💚", "Thank you! Your Fit Her plan is active again.", "planActivated");
    }
  }
  image.heldAt = null;
  image.verifyStatus = "received";
  image.verifiedAt = new Date();
  image.verifiedBy = adminId || null;
  await image.save();
}

function pkr(n) {
  const v = Number(n) || 0;
  return v ? `PKR ${v.toLocaleString("en-PK")}` : "Payment";
}

/**
 * Oct 2026: tell every admin AT ONCE when the AI approves a slip (before
 * this, the first push came after 24 h). Tap → "Confirm payments" list.
 */
async function notifyAutoApproved(image) {
  if (!image) return;
  const ref = image.ocrTransactionId ? ` · ref ${image.ocrTransactionId}` : "";
  await pushAdmins(
    "Payment to confirm",
    `${pkr(image.ocrAmount || image.paidAmount || image.price)}${ref}. Plan started by AI: check it arrived, then tap Received.`,
    { type: "paymentCheck", planImageId: String(image.id) }
  );
}

/**
 * Oct 2026: a slip the AI could NOT approve → every admin (was: only the
 * first admin, and nobody for payment-link slips). Tap → approval list.
 */
async function notifySlipForReview(image, reason) {
  if (!image) return;
  const why = reason ? String(reason).replace(/\s*—\s*admin review.*$/i, "") : "";
  await pushAdmins(
    "Slip to approve",
    `${pkr(image.price)}${why ? ` · ${why}` : ""}`.slice(0, 180),
    { type: "paymentApprovalRequest", planImageId: String(image.id) }
  );
}

/** Hourly: reminders at 24 h / 40 h, pause at 48 h. */
async function runChecks() {
  const { PlanImage } = M();
  const rows = await PlanImage.findAll({ where: { verifyStatus: "pending", verifyStartedAt: { [Op.ne]: null } } });
  const now = Date.now();
  let reminded = 0;
  let held = 0;
  const due = [];
  for (const img of rows) {
    const hours = (now - new Date(img.verifyStartedAt).getTime()) / HOUR;
    if (hours >= HOLD_AFTER_HOURS) {
      try {
        await hold(img, "held");
        held++;
      } catch (e) {
        console.error("[payment-verify] hold", img.id, e.message);
      }
      continue;
    }
    const stage = REMINDERS_AT_HOURS.filter((h) => hours >= h).length;
    if (stage > (img.verifyReminders || 0)) {
      img.verifyReminders = stage;
      await img.save();
      due.push(Math.max(1, Math.round(HOLD_AFTER_HOURS - hours)));
      reminded++;
    }
  }
  if (due.length) {
    const soonest = Math.min(...due);
    await pushAdmins(
      `${due.length} payment${due.length === 1 ? "" : "s"} to confirm`,
      `Check your JazzCash / EasyPaisa / bank app. Plans pause in ${soonest} h if not confirmed.`
    );
  }
  if (held) await pushAdmins("Plans paused", `${held} AI-approved payment${held === 1 ? " was" : "s were"} not confirmed in 48 h.`);
  return { reminded, held };
}

/** Banner data for her: the latest paused slip, or null. */
async function holdFor(userId) {
  const { PlanImage, Plan } = M();
  const img = await PlanImage.findOne({
    where: { UserId: userId, heldAt: { [Op.ne]: null }, verifyStatus: { [Op.in]: ["held", "not_received"] } },
    order: [["heldAt", "DESC"]],
  });
  if (!img) return null;
  const plan = img.PlanId ? await Plan.findByPk(img.PlanId, { attributes: ["title"] }) : null;
  return {
    planImageId: img.id,
    status: img.verifyStatus,
    amount: img.paidAmount || Number(img.price) || null,
    planTitle: plan ? plan.title : null,
    heldAt: img.heldAt,
    reference: img.ocrTransactionId || null,
    proofSent: !!img.userProof,
  };
}

async function submitProof(userId, text) {
  const { PlanImage } = M();
  const img = await PlanImage.findOne({
    where: { UserId: userId, heldAt: { [Op.ne]: null } },
    order: [["heldAt", "DESC"]],
  });
  if (!img) return false;
  img.userProof = String(text || "").trim().slice(0, 250);
  await img.save();
  await pushAdmins("Payment proof sent", `A paused client sent proof: ${img.userProof.slice(0, 80)}`);
  return true;
}

module.exports = { runChecks, hold, confirm, holdFor, submitProof, notifyAutoApproved, notifySlipForReview, HOLD_AFTER_HOURS };
