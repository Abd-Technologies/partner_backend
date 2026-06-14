/**
 * applyPlanApproval.js — apply a payment slip approval and activate the plan.
 *
 * Used by both:
 *   1. Auto-approval flow (magic link redeem with high OCR confidence)
 *   2. Admin manual approval flow (approvedImage endpoint)
 *
 * Mirrors the logic from AdminController.approvedImage so behavior stays
 * consistent — create/extend UserPlan, mark image processed, remove expired
 * and free-trial plans, update user status, notify user.
 *
 * @param {object} planImage  — PlanImage instance (must already exist)
 * @param {object} [opts]
 *   @param {string} [opts.approvalSource] — 'auto' | 'admin' (for audit log)
 *   @param {object} [opts.notify]         — { title, body } override
 * @returns {Promise<{ ok: boolean, userPlanId?: number, extended?: boolean, error?: string }>}
 */

const { Op } = require('sequelize');
const sendNotification = require('./notification');

async function applyPlanApproval(planImage, opts = {}) {
  if (!planImage) return { ok: false, error: 'planImage is required' };

  // Lazy-require to avoid circular dep at module load
  const { UserPlan, User, Plan, PriceDurations } = require('../models');

  try {
    // Load the user + plan + duration if not already attached
    let image = planImage;
    if (!image.User || !image.Plan || !image.PriceDuration) {
      image = await image.constructor.findOne({
        where: { id: planImage.id },
        include: [
          { model: User,           attributes: ['id', 'deviceToken', 'status'] },
          { model: Plan,           attributes: ['id', 'title'] },
          { model: PriceDurations, attributes: ['id', 'duration'] },
        ],
      });
    }

    if (!image) return { ok: false, error: 'PlanImage not found' };
    if (!image.UserId) {
      return { ok: false, error: 'PlanImage has no UserId — cannot activate plan' };
    }
    if (!image.PlanId) {
      return { ok: false, error: 'PlanImage has no PlanId — cannot activate plan' };
    }

    // Parse duration in days
    const durationStr = image.PriceDurations?.duration || image.PriceDuration?.duration || '30 days';
    const dayMatch = durationStr.match(/\d+/);
    const newPlanDays = dayMatch ? parseInt(dayMatch[0], 10) : 30;
    const now = new Date();

    // Check existing active plan for same user + plan
    const existingPlan = await UserPlan.findOne({
      where: {
        userId: image.UserId,
        PlanId: image.PlanId,
        expireDate: { [Op.gte]: now },
        status: true,
      },
    });

    let userPlanId;
    let extended = false;

    if (existingPlan) {
      // Extend by remaining days + new days
      const remainingMs = existingPlan.expireDate.getTime() - now.getTime();
      const remainingDays = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
      const totalDays = remainingDays + newPlanDays;

      existingPlan.expireDate     = new Date(now.getTime() + totalDays * 24 * 60 * 60 * 1000);
      existingPlan.buyingDate     = now;
      existingPlan.price          = image.paidAmount || image.price;
      existingPlan.durationIdPlan = image.PriceDurations?.id || image.PriceDurationId || null;
      await existingPlan.save();

      userPlanId = existingPlan.id;
      extended = true;
    } else {
      const created = await UserPlan.create({
        buyingDate:     now,
        expireDate:     new Date(now.getTime() + newPlanDays * 24 * 60 * 60 * 1000),
        userId:         image.UserId,
        PlanId:         image.PlanId,
        price:          image.paidAmount || image.price,
        durationIdPlan: image.PriceDurations?.id || image.PriceDurationId || null,
        status:         true,
      });
      userPlanId = created.id;
    }

    // Mark this slip as processed
    image.status = 0;
    await image.save();

    // Remove expired plans for the user (housekeeping)
    const expired = await UserPlan.findAll({
      where: {
        userId: image.UserId,
        expireDate: { [Op.lt]: now },
        status: true,
      },
    });
    for (const p of expired) {
      await p.destroy().catch(() => {});
    }

    // Remove free trial if user has one
    const freePlan = await Plan.findOne({ where: { title: 'Free Trial' } });
    if (freePlan) {
      const trialPlan = await UserPlan.findOne({
        where: { userId: image.UserId, PlanId: freePlan.id },
      });
      if (trialPlan) await trialPlan.destroy().catch(() => {});
    }

    // Update user status to active
    if (image.User) {
      image.User.status = true;
      await image.User.save().catch(() => {});
    }

    // Notify user
    if (image.User?.deviceToken) {
      const notif = opts.notify || {
        title: 'Plan activated!',
        body: opts.approvalSource === 'auto'
              ? 'Payment verified — your FitHer plan is now active. Welcome back!'
              : 'Your payment has been approved. Enjoy the best services.',
      };
      sendNotification([image.User.deviceToken], notif, { type: 'planActivated' }).catch((err) => {
        console.warn('notification send failed:', err.message);
      });
    }

    return { ok: true, userPlanId, extended };
  } catch (err) {
    console.error('applyPlanApproval error:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = { applyPlanApproval };
