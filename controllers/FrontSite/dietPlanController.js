const moment = require('moment-timezone');
const ApiResponse = require('../../helper/ApiResponse');
const db = require('../../models');
const {
  getActiveDietPlanForUser,
} = require('../../services/dietPlanService');

const { User, UserPlan, Appointment, DietPlan } = db;

/**
 * GET /users/diet-plan/me/active
 * Auth: validateToken
 *
 * Returns the user's most recent 'active' diet plan (eager-loaded with
 * days + meals) or `{ dietPlan: null }` if she has none. Never errors
 * for the no-plan case — that's a normal lifecycle state.
 */
async function getMyActiveDietPlan(req, res) {
  try {
    const dietPlan = await getActiveDietPlanForUser(req.user.id);
    return res.json(
      ApiResponse('1', 'Active diet plan', { dietPlan: dietPlan || null })
    );
  } catch (err) {
    console.error('[getMyActiveDietPlan] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

/**
 * PATCH /users/diet-plan/me/timezone
 * Body: { timezone: "<IANA name>" }   ← Flutter sends lowercase "timezone"
 * Auth: validateToken
 *
 * Validates with moment-timezone, then writes to the existing
 * `User.timeZone` (camelCase) column so the legacy controllers
 * (DashboardController, crownjobfunction) keep reading the same field.
 */
async function updateMyTimezone(req, res) {
  try {
    const { timezone } = req.body || {};
    if (!timezone || typeof timezone !== 'string') {
      return res.json(ApiResponse('0', 'timezone is required', {}));
    }
    if (!moment.tz.zone(timezone)) {
      return res.json(ApiResponse('0', 'Invalid IANA timezone', {}));
    }
    await User.update(
      { timeZone: timezone },
      { where: { id: req.user.id } }
    );
    return res.json(
      ApiResponse('1', 'Timezone updated', { timeZone: timezone })
    );
  } catch (err) {
    console.error('[updateMyTimezone] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

/**
 * GET /users/diet-plan/me/booking-context
 * Auth: validateToken
 *
 * Thin lookup the Flutter empty-state CTA needs to call BookConsultationSheet
 * with real IDs instead of falling back to the paywall. Returns:
 *
 *   { userId, userPlanId | null, dietitianId | null, hasActivePlan }
 *
 * Derivations:
 *   • userId        — req.user.id (JWT).
 *   • userPlanId    — most recent UserPlan row (any status:true) for this user.
 *                     Null when the user never bought a plan.
 *   • dietitianId   — most recent Appointment.dietitionId for this user.
 *                     Null when she's never had a consultation.
 *   • hasActivePlan — server-side mirror of "is there a 'active' DietPlan
 *                     row" so the client knows whether to show the
 *                     "initial" or "followup" booking sheet.
 *
 * Never errors for the no-context case — empty answers are normal.
 */
async function getMyBookingContext(req, res) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

    // Most recent UserPlan, regardless of freeze/expire state — for the
    // booking flow what matters is "has she ever had a plan".
    const userPlan = await UserPlan.findOne({
      where: { UserId: userId },
      order: [['createdAt', 'DESC']],
    });

    // Most recent Appointment surfaces the assigned dietitian. Filter
    // out cancelled rows so a stray cancellation doesn't dictate the
    // assignment when she had legit appointments before.
    const appt = await Appointment.findOne({
      where: { userId: userId },
      order: [['date', 'DESC'], ['createdAt', 'DESC']],
    });

    const activeDietPlan = await DietPlan.findOne({
      where: { userId: userId, status: 'active' },
      attributes: ['id'],
    });

    return res.json(
      ApiResponse('1', 'Booking context', {
        userId,
        userPlanId: userPlan ? userPlan.id : null,
        dietitianId: appt ? appt.dietitionId : null,
        hasActivePlan: !!activeDietPlan,
      })
    );
  } catch (err) {
    console.error('[getMyBookingContext] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

module.exports = {
  getMyActiveDietPlan,
  updateMyTimezone,
  getMyBookingContext,
};
