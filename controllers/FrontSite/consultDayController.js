// Admin: one day of consultations (Nov 2026).
//
// GET /appointment/admin/day?date=YYYY-MM-DD   (default: today, Pakistan)
// For that day:
//   • every session scheduled that day: client, dietitian, time, status,
//     when the dietitian started / ended, when the client joined / left
//     (helper/consultAttendance.js), her rating;
//   • bookings MADE that day;
//   • diet plans delivered (activated by a dietitian) that day;
//   • a summary per dietitian.

const { Op } = require("sequelize");
const moment = require("moment-timezone");
const ApiResponse = require("../../helper/ApiResponse");

const PKT = "Asia/Karachi";
const nameOf = (u, f = "—") => (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "") || f;

exports.day = async (req, res) => {
  try {
    const db = require("../../models");
    const { Appointment, User, SlotDiet, AppointmentReview, DietPlan, sequelize } = db;
    const q = typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : null;
    const dayStr = q || moment().tz(PKT).format("YYYY-MM-DD");
    const from = moment.tz(dayStr, "YYYY-MM-DD", PKT).startOf("day").toDate();
    const to = moment.tz(dayStr, "YYYY-MM-DD", PKT).endOf("day").toDate();
    const summarize = require("../../helper/consultAttendance").summarize;
    const bp = require("../../helper/bookingPolicy");

    const include = [
      { model: User, as: "ClientUser", attributes: ["id", "firstName", "lastName", "email", "phone"] },
      { model: User, attributes: ["id", "firstName", "lastName"] }, // dietitian
      { model: SlotDiet, attributes: ["id", "start", "end"] },
      { model: AppointmentReview, attributes: ["id", "rating", "comment", "createdAt"], required: false },
    ];

    // Sessions scheduled that day (date is the calendar day, stored as-is).
    const sessions = await Appointment.findAll({
      where: { [Op.and]: [sequelize.where(sequelize.fn("DATE", sequelize.col("Appointment.date")), dayStr)] },
      include,
    });
    // Bookings made that day (any session date).
    const booked = await Appointment.findAll({
      where: { createdAt: { [Op.between]: [from, to] } },
      include,
    });
    // Plans delivered that day by a dietitian.
    const plans = await DietPlan.findAll({
      where: { activatedAt: { [Op.between]: [from, to] }, dietitianId: { [Op.ne]: null } },
      attributes: ["id", "userId", "dietitianId", "activatedAt", "status"],
      include: [
        { model: User, attributes: ["id", "firstName", "lastName"] },
        { model: User, as: "Dietitian", attributes: ["id", "firstName", "lastName"] },
      ],
      order: [["activatedAt", "ASC"]],
    });

    const row = (a) => {
      const att = summarize(a, a.SlotDiet);
      const st = bp.sessionStartSync(a, a.SlotDiet);
      const review = a.AppointmentReview || null;
      return {
        id: a.id,
        status: a.status,
        kind: a.kind,
        date: moment(a.date).utc().format("YYYY-MM-DD"),
        start: a.SlotDiet ? a.SlotDiet.start : null,
        end: a.SlotDiet ? a.SlotDiet.end : null,
        startsAt: st,
        client: a.ClientUser
          ? { id: a.ClientUser.id, name: nameOf(a.ClientUser), email: a.ClientUser.email, phone: a.ClientUser.phone }
          : null,
        dietitian: a.User ? { id: a.User.id, name: nameOf(a.User) } : null,
        bookedAt: a.createdAt,
        attendance: att,
        clientNoShow: !!a.clientNoShowAt,
        dietitianNoShow: !!a.noShowReportedAt,
        canceledBy:
          a.status === "canceledByUser"
            ? "client"
            : a.status === "canceled"
            ? a.noShowReportedAt
              ? "auto: dietitian didn't start"
              : a.clientNoShowAt
              ? "client didn't join"
              : a.expiredAt
              ? "auto: never confirmed"
              : "dietitian"
            : null,
        rating: review ? { stars: review.rating, comment: review.comment, at: review.createdAt } : null,
      };
    };

    const sessionRows = sessions.map(row).sort((x, y) => (x.startsAt || 0) - (y.startsAt || 0));
    const bookedRows = booked.map(row).sort((x, y) => new Date(x.bookedAt) - new Date(y.bookedAt));
    const planRows = plans.map((p) => ({
      id: p.id,
      deliveredAt: p.activatedAt,
      client: p.User ? { id: p.User.id, name: nameOf(p.User) } : null,
      dietitian: p.Dietitian ? { id: p.Dietitian.id, name: nameOf(p.Dietitian) } : null,
    }));

    // Per dietitian.
    const per = new Map();
    const get = (d) => {
      if (!d) return null;
      if (!per.has(d.id))
        per.set(d.id, {
          dietitianId: d.id, name: d.name,
          scheduled: 0, done: 0, live: 0, upcoming: 0, missedByClient: 0, dietitianNoShow: 0, canceled: 0,
          bookedToday: 0, plansDelivered: 0, ratings: [], lateStarts: 0,
        });
      return per.get(d.id);
    };
    for (const r of sessionRows) {
      const p = get(r.dietitian);
      if (!p) continue;
      p.scheduled++;
      if (r.status === "completed") p.done++;
      else if (r.status === "In Progress") p.live++;
      else if (r.status === "confirmed" || r.status === "pending") p.upcoming++;
      else if (r.clientNoShow) p.missedByClient++;
      else if (r.dietitianNoShow) p.dietitianNoShow++;
      else p.canceled++;
      if (r.rating) p.ratings.push(r.rating.stars);
      const started = r.attendance && r.attendance.dietitian && r.attendance.dietitian.startedAt;
      if (started && r.startsAt && new Date(started) - new Date(r.startsAt) > 5 * 60000) p.lateStarts++;
    }
    for (const r of bookedRows) {
      const p = get(r.dietitian);
      if (p) p.bookedToday++;
    }
    for (const r of planRows) {
      const p = get(r.dietitian);
      if (p) p.plansDelivered++;
    }
    const dietitians = [...per.values()]
      .map(({ ratings, ...p }) => ({
        ...p,
        ratingCount: ratings.length,
        ratingAvg: ratings.length ? Number((ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(1)) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const ratings = sessionRows.filter((r) => r.rating).map((r) => r.rating.stars);
    return res.json(
      ApiResponse("1", "Consultation day", {
        date: dayStr,
        totals: {
          scheduled: sessionRows.length,
          done: sessionRows.filter((r) => r.status === "completed").length,
          live: sessionRows.filter((r) => r.status === "In Progress").length,
          upcoming: sessionRows.filter((r) => r.status === "confirmed" || r.status === "pending").length,
          missedByClient: sessionRows.filter((r) => r.clientNoShow).length,
          dietitianNoShow: sessionRows.filter((r) => r.dietitianNoShow).length,
          bookedToday: bookedRows.length,
          plansDelivered: planRows.length,
          ratingAvg: ratings.length ? Number((ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(1)) : null,
          ratingCount: ratings.length,
        },
        dietitians,
        sessions: sessionRows,
        booked: bookedRows,
        plans: planRows,
      })
    );
  } catch (err) {
    console.error("[consultDay]", err.message);
    return res.json(ApiResponse("0", "Couldn't load the day.", {}));
  }
};
