// Dietitian from the plan she bought (Oct 2026).
//
// Every package (Plan) carries its dietitian (Plan.dietitianId, set by the
// admin on the package). On approval her purchase (UserPlan) gets that
// dietitian, so booking, the dietitian's client list and plan delivery all
// know who she belongs to. Before, only DirectPay copied it; slip
// approvals (AI and admin) didn't, and booking relied on a fallback.
// A renewal keeps the dietitian she already has (continuity).
// A diet / combined package with NO dietitian set → admin alert at once,
// so a paid client is never left unable to book.
const M = () => require("../models");

async function assignFromPlan(userPlanId) {
  if (!userPlanId) return null;
  const { UserPlan, Plan, User } = M();
  try {
    const up = await UserPlan.findByPk(userPlanId);
    if (!up) return null;
    const plan = up.PlanId
      ? await Plan.findByPk(up.PlanId, { attributes: ["id", "title", "dietitianId", "planType"] })
      : null;
    if (!plan) return null;
    if (!up.dietitianId && plan.dietitianId) {
      up.dietitianId = plan.dietitianId;
      await up.save();
      return up.dietitianId;
    }
    const needsDietitian = ["diet", "combined"].includes(String(plan.planType || "").toLowerCase());
    if (needsDietitian && !up.dietitianId && !plan.dietitianId) {
      const client = await User.findByPk(up.userId, { attributes: ["firstName", "lastName"] });
      const name = client ? `${client.firstName || ""} ${client.lastName || ""}`.trim() || "A client" : "A client";
      await require("./escalation").createEscalation({
        userId: up.userId,
        trigger: "SYSTEM_ISSUE",
        severity: "high",
        payload: { userPlanId: up.id, planId: plan.id, issue: "plan_has_no_dietitian" },
        copy: {
          title: "Paid client has no dietitian",
          body: `${name} bought "${plan.title}", but that package has no dietitian set, so she can't book her consultation. Set a dietitian on the package.`,
        },
      });
    }
    return up.dietitianId || null;
  } catch (e) {
    console.error("[plan-dietitian] assign:", e.message);
    return null;
  }
}

module.exports = { assignFromPlan };
