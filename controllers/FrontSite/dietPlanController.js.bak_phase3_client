const moment = require('moment-timezone');
const ApiResponse = require('../../helper/ApiResponse');
const db = require('../../models');
const {
  getActiveDietPlanForUser,
} = require('../../services/dietPlanService');

const { User, UserPlan, Appointment, DietPlan, Plan } = db;

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
 * Derivations, tried in order until one yields a dietitianId:
 *   1. The active DietPlan row's own `dietitianId` — set when a
 *      dietitian authors/activates a structured (AI) plan.
 *   2. The UserPlan row's `dietitianId` — set by the legacy admin
 *      purchase-approval flow (AdminController.payment_success),
 *      which is how a workout+diet PACKAGE gets its dietitian
 *      assigned at purchase time, often well before any Appointment
 *      or structured DietPlan exists. Requires `models/User.js`'s
 *      `UserPlan.belongsTo(User, { as: 'Dietition', foreignKey:
 *      'dietitianId' })` association to be registered — it was
 *      previously commented out, which silently meant `dietitianId`
 *      was never persisted at all (see that file's comment).
 *   3. The most recent Appointment's dietitionId — last resort for
 *      legacy rows that predate columns 1/2.
 *
 *   • userId        — req.user.id (JWT).
 *   • userPlanId    — the UserPlan tied to whichever of the above
 *                     resolved a dietitianId, else the most recent
 *                     UserPlan of any kind. Null when she never
 *                     bought a plan.
 *   • hasActivePlan — server-side mirror of "is there a 'active' DietPlan
 *                     row" so the client knows whether to show the
 *                     "initial" or "followup" booking sheet.
 *
 * IMPORTANT: a user can hold multiple simultaneous UserPlan rows (e.g. an
 * older workout-only purchase alongside a newer combined workout+diet
 * one). We order by "has a dietitianId" first so a combined package's
 * assignment always wins over an older/unrelated row, rather than just
 * taking whichever was created most recently.
 *
 * Never errors for the no-context case — empty answers are normal.
 */
async function getMyBookingContext(req, res) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse('0', 'Unauthorized', {}));

    // 1. The active DietPlan already knows which UserPlan it belongs to
    // and which dietitian owns it.
    const activeDietPlan = await DietPlan.findOne({
      where: { userId: userId, status: 'active' },
      attributes: ['id', 'userPlanId', 'dietitianId'],
      order: [['activatedAt', 'DESC'], ['createdAt', 'DESC']],
    });

    // 2. Legacy/admin-assigned dietitian, direct on the UserPlan row —
    // eager-load its Plan too, since the Plan itself carries a
    // dietitianId baked in per package/SKU (set once when the plan was
    // created, not re-entered per approval). That covers purchases
    // approved before `AdminController.payment_success` was fixed to
    // pull dietitianId from the Plan automatically — no re-approval
    // needed for those older rows. Prefer a row that actually HAS a
    // dietitianId (on itself or its Plan) over just the newest row, so
    // an old workout-only purchase never shadows a newer combined
    // package's assignment.
    const userPlan = await UserPlan.findOne({
      where: { UserId: userId },
      include: [{ model: Plan, attributes: ['id', 'title', 'dietitianId'] }],
      order: [
        [db.sequelize.literal('`UserPlan`.`dietitianId` IS NULL'), 'ASC'],
        ['createdAt', 'DESC'],
      ],
    });
    const userPlanDietitianId =
      userPlan &&
      (userPlan.dietitianId != null
        ? userPlan.dietitianId
        : (userPlan.Plan && userPlan.Plan.dietitianId) || null);

    // 3. Most recent Appointment — last-resort fallback.
    const haveDietitianAlready =
      !!(activeDietPlan && activeDietPlan.dietitianId) || !!userPlanDietitianId;
    const appt = haveDietitianAlready
      ? null
      : await Appointment.findOne({
          where: { userId: userId },
          order: [['date', 'DESC'], ['createdAt', 'DESC']],
        });

    const userPlanId = activeDietPlan
      ? activeDietPlan.userPlanId
      : (userPlan ? userPlan.id : null);

    const dietitianId =
      (activeDietPlan && activeDietPlan.dietitianId) ||
      userPlanDietitianId ||
      (appt ? appt.dietitionId : null) ||
      null;

    return res.json(
      ApiResponse('1', 'Booking context', {
        userId,
        userPlanId,
        dietitianId,
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
