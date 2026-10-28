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
    // AI-approved: admin must confirm the money arrived within 48 h
    // (helper/paymentVerify.js), otherwise this plan is paused.
    if (opts.approvalSource === 'auto') {
      image.verifyStatus = 'pending';
      image.verifyUserPlanId = userPlanId;
      image.verifyExtended = extended;
      image.verifyDays = newPlanDays;
      image.verifyStartedAt = now;
    }
    await image.save();
    // Oct 2026: admins hear about an AI approval at once (not after 24 h).
    if (opts.approvalSource === 'auto') {
      require('./paymentVerify').notifyAutoApproved(image).catch(() => {});
    }

    // Her ended plans (Oct 2026): switched OFF, no longer deleted. Deleting
    // a plan also deleted (DB cascade) its diet plan, Day 7 review and
    // progress, and an ended trial plan was deleted here before its AI
    // diet plan could be moved to the paid plan. status=false hides it
    // from her plan list; planStatus 'expired' is set by the hourly job.
    await UserPlan.update(
      { status: false },
      {
        where: {
          userId: image.UserId,
          expireDate: { [Op.lt]: now },
          status: true,
          id: { [Op.ne]: userPlanId },
        },
      }
    ).catch((e) => console.warn('[applyPlanApproval] switch off ended plans:', e.message));

    // Remove free trial if user has one
    // Oct 2026: her dietitian comes from the package she bought.
    await require('./planDietitianAssign').assignFromPlan(userPlanId);

    // Oct 2026: keep her trial diet plan / Day 7 review / progress (moved to
    // the paid plan) and mark the trial converted, BEFORE the trial row is
    // deleted below (the DB would cascade-delete them).
    await require('./trialConversion').onPaidPlan(image.UserId, userPlanId);

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

    // Purchase history + server-side Mixpanel "Purchase" (add-on).
    require('./purchaseLedger').purchased({
      planImage: image,
      userPlanId,
      approvedBy: opts.approvalSource === 'auto' ? 'auto' : 'admin',
      approvedById: opts.approvedById || null,
    });

    return { ok: true, userPlanId, extended };
  } catch (err) {
    console.error('applyPlanApproval error:', err);
    return { ok: false, error: err.message };
  }
}

module.exports = { applyPlanApproval };
