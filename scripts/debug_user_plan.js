'use strict';

// One-off, read-only diagnostic — prints exactly what the DB holds for a
// user's UserPlan row(s), so we can see directly why getActivePlan()
// (planFreezeController.js) does or doesn't consider one "active",
// instead of guessing from the app's freeze/cancel error messages alone.
//
// Usage (from the partner_backend folder, wherever the live server/DB
// connection actually works — this doesn't reach the DB from Claude's
// sandbox, only from your own machine):
//   node scripts/debug_user_plan.js 88

const { User, UserPlan, Plan } = require('../models');

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.log('Usage: node scripts/debug_user_plan.js <userId>');
    process.exit(1);
  }

  const user = await User.findByPk(userId, {
    include: [{ model: UserPlan, include: [{ model: Plan, attributes: ['id', 'title'] }] }],
  });

  if (!user) {
    console.log(`No User found with id ${userId}`);
    process.exit(0);
  }

  console.log(`User ${user.id} — email: ${user.email} — User.status (account-level paid flag): ${user.status}`);

  const plans = user.UserPlans || [];
  console.log(`UserPlan rows found (via the User->UserPlan association): ${plans.length}`);

  const now = new Date();
  for (const p of plans) {
    const isFuture = p.expireDate ? new Date(p.expireDate) > now : null;
    const notCancelled = p.planStatus !== 'cancelled';
    console.log('---');
    console.log('UserPlan.id:        ', p.id);
    console.log('UserPlan.userId:    ', p.userId, '(should equal', userId + ')');
    console.log('Plan:               ', p.Plan ? `${p.Plan.title} (planId ${p.Plan.id})` : '(no Plan row / null PlanId)');
    console.log('planStatus:         ', p.planStatus, notCancelled ? '' : '  <-- EXCLUDED by getActivePlan (planStatus == cancelled)');
    console.log('UserPlan.status:    ', p.status, '(separate from User.status above — does NOT gate freeze/cancel)');
    console.log('expireDate:         ', p.expireDate, isFuture ? '(in the future)' : '  <-- EXCLUDED by getActivePlan (not in the future)');
    console.log('frozenAt:           ', p.frozenAt);
    console.log('cancelledAt:        ', p.cancelledAt);
    console.log('cancelReason:       ', p.cancelReason);
    console.log('cancelledBy:        ', p.cancelledBy);
    console.log('WOULD getActivePlan consider this row active?', notCancelled && isFuture ? 'YES' : 'NO');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('debug_user_plan failed:', e);
  process.exit(1);
});
