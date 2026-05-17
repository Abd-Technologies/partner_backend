const { Op, fn, col, literal } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const {
  Appointment,
  ClassAttendance,
  DailyCheckin,
  EscalationTicket,
  PdfDietsForUserNew,
  Plan,
  User,
  UserPlan,
} = require("../../models");

// Section 15 metrics. Kept in one endpoint so the admin home can render
// the dashboard from a single fetch. Each subobject is computed inside
// a try/catch — an exception in one block returns null for that block
// rather than failing the whole response.
//
// All "active plans" filters use status=true AND expireDate >= now (the
// same shape PaidHomeController.hasActivePaidPlan uses elsewhere).

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek() {
  const d = startOfToday();
  // Monday-anchored week. JS getDay(): 0=Sun..6=Sat → diff to Monday.
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

async function activeUsersByPlanType() {
  // Counts unique paid users grouped by Plan.title. Includes only
  // currently-active rows so churn doesn't leak in.
  try {
    const rows = await UserPlan.findAll({
      where: {
        status: true,
        expireDate: { [Op.gte]: new Date() },
      },
      include: [
        {
          model: Plan,
          attributes: ["id", "title"],
        },
      ],
      attributes: ["userId"],
    });
    const byTitle = new Map();
    for (const r of rows) {
      const title = r.Plan?.title ?? "Unknown";
      byTitle.set(title, (byTitle.get(title) ?? 0) + 1);
    }
    const out = {};
    for (const [k, v] of byTitle.entries()) out[k] = v;
    return out;
  } catch (err) {
    console.error("[metrics] activeUsersByPlanType:", err);
    return null;
  }
}

async function consultationsCounts({ from }) {
  try {
    const rows = await Appointment.findAll({
      where: { date: { [Op.gte]: from } },
      attributes: ["status", "noShowReportedAt"],
    });
    const counts = {
      booked: rows.length,
      completed: 0,
      no_show: 0,
      pending: 0,
      confirmed: 0,
      in_progress: 0,
      cancelled: 0,
    };
    for (const r of rows) {
      if (r.noShowReportedAt) counts.no_show++;
      switch (r.status) {
        case "completed":
          counts.completed++;
          break;
        case "pending":
          counts.pending++;
          break;
        case "confirmed":
          counts.confirmed++;
          break;
        case "In Progress":
          counts.in_progress++;
          break;
        case "canceled":
        case "canceledByUser":
          counts.cancelled++;
          break;
        default:
          break;
      }
    }
    return counts;
  } catch (err) {
    console.error("[metrics] consultationsCounts:", err);
    return null;
  }
}

async function plansPendingDelivery() {
  // Active UserPlans where the initial Appointment is "completed" but
  // no PdfDiet exists yet. Day-3 breaches are surfaced separately.
  try {
    const completed = await Appointment.findAll({
      where: { status: "completed" },
      attributes: ["userId", "planId", "status_changed_at", "updatedAt"],
    });
    if (completed.length === 0) return { count: 0, day3Breach: 0 };

    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    let pending = 0;
    let day3Breach = 0;

    for (const a of completed) {
      const planId = a.planId;
      if (!planId) continue;
      const pdf = await PdfDietsForUserNew.findOne({
        where: { userPlanId: planId },
      });
      if (pdf) continue;
      pending++;
      const completedAt = a.status_changed_at || a.updatedAt;
      if (completedAt && now - new Date(completedAt).getTime() > threeDaysMs) {
        day3Breach++;
      }
    }
    return { count: pending, day3Breach };
  } catch (err) {
    console.error("[metrics] plansPendingDelivery:", err);
    return null;
  }
}

async function dailyLogComplianceToday() {
  // Active-plan users / users that posted a DailyCheckin today.
  try {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1)
      .padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const activeUserIds = await UserPlan.findAll({
      where: {
        status: true,
        expireDate: { [Op.gte]: new Date() },
      },
      attributes: ["userId"],
      group: ["userId"],
    });
    const totalActive = activeUserIds.length;
    if (totalActive === 0) {
      return { totalActive: 0, loggedToday: 0, ratePct: 0 };
    }
    const ids = activeUserIds.map((r) => r.userId);
    const logged = await DailyCheckin.count({
      where: {
        userId: { [Op.in]: ids },
        date: todayStr,
      },
    });
    return {
      totalActive,
      loggedToday: logged,
      ratePct: Math.round((logged / totalActive) * 100),
    };
  } catch (err) {
    console.error("[metrics] dailyLogComplianceToday:", err);
    return null;
  }
}

async function workoutAttendanceWeek() {
  try {
    const since = startOfWeek();
    const sinceStr = since.toISOString().slice(0, 10);
    const ids = (
      await UserPlan.findAll({
        where: {
          status: true,
          expireDate: { [Op.gte]: new Date() },
        },
        attributes: ["userId"],
        group: ["userId"],
      })
    ).map((r) => r.userId);
    const totalActive = ids.length;
    if (totalActive === 0) {
      return { totalActive: 0, attendedThisWeek: 0, ratePct: 0 };
    }
    const attended = await ClassAttendance.findAll({
      where: {
        user_id: { [Op.in]: ids },
        attended_at: { [Op.gte]: sinceStr },
      },
      attributes: ["user_id"],
      group: ["user_id"],
    });
    return {
      totalActive,
      attendedThisWeek: attended.length,
      ratePct: Math.round((attended.length / totalActive) * 100),
    };
  } catch (err) {
    console.error("[metrics] workoutAttendanceWeek:", err);
    return null;
  }
}

async function escalationsByTrigger() {
  try {
    const rows = await EscalationTicket.findAll({
      attributes: [
        "trigger",
        "status",
        [fn("COUNT", col("id")), "count"],
      ],
      group: ["trigger", "status"],
    });
    const byTrigger = {};
    for (const r of rows) {
      const t = r.get("trigger");
      const s = r.get("status");
      const c = parseInt(r.get("count"), 10);
      byTrigger[t] = byTrigger[t] || {};
      byTrigger[t][s] = c;
    }
    return byTrigger;
  } catch (err) {
    console.error("[metrics] escalationsByTrigger:", err);
    return null;
  }
}

async function slaBreachByDietitian() {
  // Open escalations that name a dietitian, grouped + joined to surface
  // the dietitian's name on the dashboard.
  try {
    const rows = await EscalationTicket.findAll({
      where: {
        status: { [Op.in]: ["open", "acknowledged"] },
        dietitianId: { [Op.ne]: null },
      },
      attributes: [
        "dietitianId",
        [fn("COUNT", col("EscalationTicket.id")), "count"],
      ],
      include: [
        {
          model: User,
          as: "dietitian",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      group: ["dietitianId", "dietitian.id"],
    });
    return rows.map((r) => ({
      dietitianId: r.dietitianId,
      dietitianName: r.dietitian
        ? `${r.dietitian.firstName || ""} ${r.dietitian.lastName || ""}`.trim()
        : null,
      openCount: parseInt(r.get("count"), 10),
    }));
  } catch (err) {
    console.error("[metrics] slaBreachByDietitian:", err);
    return null;
  }
}

// GET /admin/metrics/overview
exports.overview = async (req, res) => {
  const today = startOfToday();
  const week = startOfWeek();

  // Run all subqueries in parallel — they don't depend on each other.
  // Promise.all is fine here because each helper already returns null
  // on internal failure (no rejection escapes), so allSettled isn't
  // needed.
  const [
    activeUsers,
    consultsToday,
    consultsWeek,
    pendingDelivery,
    logCompliance,
    workoutAttendance,
    escByTrigger,
    slaPerDietitian,
  ] = await Promise.all([
    activeUsersByPlanType(),
    consultationsCounts({ from: today }),
    consultationsCounts({ from: week }),
    plansPendingDelivery(),
    dailyLogComplianceToday(),
    workoutAttendanceWeek(),
    escalationsByTrigger(),
    slaBreachByDietitian(),
  ]);

  return res.json(
    ApiResponse("1", "Metrics", {
      activeUsersByPlanType: activeUsers,
      consultations: {
        today: consultsToday,
        thisWeek: consultsWeek,
      },
      plansPendingDelivery: pendingDelivery,
      dailyLogComplianceToday: logCompliance,
      workoutAttendanceWeek: workoutAttendance,
      escalationsByTrigger: escByTrigger,
      slaBreachPerDietitian: slaPerDietitian,
    })
  );
};
