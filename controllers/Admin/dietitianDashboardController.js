const { Op, fn, col, literal } = require("sequelize");
const { Appointment, User, AppointmentReview, sequelize } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const { isUnscopedRole } = require("../../helper/dietitianScope");

// Default range = last 30 days, anchored to UTC. Caller can override
// with from/to query params (YYYY-MM-DD). Range is inclusive on both
// ends — the SQL bounds add 23:59:59 to `to` to capture same-day
// appointments.
const DEFAULT_RANGE_DAYS = 30;
const RECENT_REVIEW_LIMIT = 10;

function parseRange(req) {
  const now = new Date();
  let to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : new Date(now);
  let from = req.query.from
    ? new Date(`${req.query.from}T00:00:00.000Z`)
    : new Date(now.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from > to) return null;
  return { from, to };
}

// Buckets every appointment in [from, to] for one dietitian into the
// summary the dashboard renders. Uses only existing columns:
//   • status                — pending/confirmed/In Progress/completed/canceled/canceledByUser
//   • completed_by          — NULL means the cron flipped it (ran past slot.end + 2min grace)
// "On time" = manually completed (the dietitian clicked End before the
// cron's grace window expired). "Ran over" = cron-completed.
exports.getDietitianConsultationDashboard = async (req, res) => {
  // Scoped to the logged-in staff member: previously this trusted the
  // :dietitianId URL param outright, so any dietitian could view any
  // other dietitian's consultation stats and reviews just by changing
  // the id. Only an Admin may look up an arbitrary dietitian this way;
  // everyone else always gets their own dashboard regardless of what's
  // in the URL.
  const dietitianId = isUnscopedRole(req.user && req.user.userType)
    ? req.params.dietitianId
    : req.user && req.user.id;
  if (!dietitianId) {
    return res.json(ApiResponse("0", "dietitianId is required", {}));
  }

  const range = parseRange(req);
  if (!range) {
    return res.json(ApiResponse("0", "Invalid from/to (expected YYYY-MM-DD, from <= to)", {}));
  }

  try {
    const dietitian = await User.findOne({
      where: { id: dietitianId, userType: "Dietition" },
      attributes: ["id", "firstName", "lastName", "email", "speciality"],
    });
    if (!dietitian) {
      return res.status(404).json(ApiResponse("0", "Dietitian not found", {}));
    }

    const dateBetween = { [Op.between]: [range.from, range.to] };

    // Single GROUP BY pass — one row per (status, completed_by IS NULL).
    // Avoids N round-trips for each bucket count.
    const rawCounts = await Appointment.findAll({
      where: { dietitionId: dietitianId, date: dateBetween },
      attributes: [
        "status",
        [literal("CASE WHEN completed_by IS NULL THEN 1 ELSE 0 END"), "endedByCron"],
        [fn("COUNT", col("id")), "n"],
      ],
      group: ["status", literal("CASE WHEN completed_by IS NULL THEN 1 ELSE 0 END")],
      raw: true,
    });

    const summary = {
      total: 0,
      completed: 0,
      completedOnTime: 0,
      completedRanOver: 0,
      canceledByDietitian: 0,
      canceledByUser: 0,
      pending: 0,
      confirmed: 0,
      inProgress: 0,
    };
    for (const row of rawCounts) {
      const n = Number(row.n);
      summary.total += n;
      if (row.status === "completed") {
        summary.completed += n;
        if (Number(row.endedByCron) === 1) summary.completedRanOver += n;
        else summary.completedOnTime += n;
      } else if (row.status === "canceled") summary.canceledByDietitian += n;
      else if (row.status === "canceledByUser") summary.canceledByUser += n;
      else if (row.status === "pending") summary.pending += n;
      else if (row.status === "confirmed") summary.confirmed += n;
      else if (row.status === "In Progress") summary.inProgress += n;
    }

    // Per-day completed counts for a sparkline. Group by DATE(date)
    // so a busy 4-PM consultation and a 9-AM one on the same day
    // collapse into one bucket.
    const byDayRows = await Appointment.findAll({
      where: {
        dietitionId: dietitianId,
        date: dateBetween,
        status: "completed",
      },
      attributes: [
        [fn("DATE", col("date")), "day"],
        [fn("COUNT", col("id")), "completed"],
        [
          fn("SUM", literal("CASE WHEN completed_by IS NULL THEN 1 ELSE 0 END")),
          "ranOver",
        ],
      ],
      group: [literal("DATE(date)")],
      order: [[literal("DATE(date)"), "ASC"]],
      raw: true,
    });

    const byDay = byDayRows.map((r) => ({
      date: r.day,
      completed: Number(r.completed),
      ranOver: Number(r.ranOver) || 0,
      onTime: Number(r.completed) - (Number(r.ranOver) || 0),
    }));

    // Reviews: avg + count + the 10 most recent ones with the client's
    // name. Only reviews tied to appointments WITHIN the range.
    const reviewAgg = await AppointmentReview.findOne({
      attributes: [
        [fn("COUNT", col("AppointmentReview.id")), "count"],
        [fn("AVG", col("rating")), "avgRating"],
      ],
      include: [
        {
          model: Appointment,
          attributes: [],
          required: true,
          where: { dietitionId: dietitianId, date: dateBetween },
        },
      ],
      raw: true,
    });

    const recentReviews = await AppointmentReview.findAll({
      include: [
        {
          model: Appointment,
          attributes: ["id", "date"],
          required: true,
          where: { dietitionId: dietitianId, date: dateBetween },
        },
        {
          model: User,
          as: "Reviewer",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
      order: [["createdAt", "DESC"]],
      limit: RECENT_REVIEW_LIMIT,
    });

    const reviews = {
      count: Number(reviewAgg?.count) || 0,
      avgRating: reviewAgg?.avgRating != null ? Number(Number(reviewAgg.avgRating).toFixed(2)) : null,
      recent: recentReviews.map((r) => ({
        id: r.id,
        appointmentId: r.appointmentId,
        appointmentDate: r.Appointment?.date,
        rating: r.rating,
        comment: r.comment,
        reviewer: r.Reviewer
          ? { id: r.Reviewer.id, name: `${r.Reviewer.firstName ?? ""} ${r.Reviewer.lastName ?? ""}`.trim() }
          : null,
        createdAt: r.createdAt,
      })),
    };

    return res.json(
      ApiResponse("1", "Dashboard fetched", {
        dietitian,
        range: {
          from: range.from.toISOString().slice(0, 10),
          to: range.to.toISOString().slice(0, 10),
        },
        summary,
        byDay,
        reviews,
      })
    );
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json(
      ApiResponse("0", "Error building dashboard", { error: error.message })
    );
  }
};
