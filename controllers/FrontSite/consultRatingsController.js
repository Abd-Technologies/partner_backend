// Consultation ratings (Nov 2026).
//
// GET /appointment/ratings/me?days=30   the dietitian's own ratings.
//     Anonymous (no client names) so clients can be honest. Same shape as
//     the trainer's class ratings page: average, stars, what they loved,
//     what to improve, plus the latest notes (no names).
// GET /appointment/ratings/all?days=30  Admin: every dietitian's average,
//     and the low (1-2 star) ratings WITH the client's name, to follow up.
//
// A rating's comment is "tag, tag | her note" (the app's rating card).

const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");

const GOOD_TAGS = ["Listened to me", "Clear advice", "Felt personal", "On time"];
const BAD_TAGS = ["Felt rushed", "Advice unclear", "Started late", "Call problems"];

function daysOf(req) {
  const d = parseInt(req.query.days, 10);
  return [7, 30, 90, 365].includes(d) ? d : 30;
}

function splitComment(comment) {
  const text = String(comment || "").trim();
  if (!text) return { tags: [], note: null };
  const all = [...GOOD_TAGS, ...BAD_TAGS];
  const tags = all.filter((t) => text.includes(t));
  const parts = text.split(" | ");
  let note = text;
  if (tags.length) {
    const first = parts[0].split(",").map((x) => x.trim());
    const firstIsTags = first.every((x) => all.includes(x));
    note = firstIsTags ? parts.slice(1).join(" | ").trim() || null : text;
  }
  return { tags, note };
}

function summarize(rows) {
  const count = rows.length;
  const average = count ? Number((rows.reduce((s, r) => s + r.rating, 0) / count).toFixed(2)) : null;
  const stars = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: rows.filter((r) => r.rating === n).length }));
  const tally = (list) =>
    list
      .map((tag) => ({ tag, count: rows.filter((r) => splitComment(r.comment).tags.includes(tag)).length }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count);
  return { count, average, stars, loved: tally(GOOD_TAGS), improve: tally(BAD_TAGS) };
}

async function reviewsSince(days, where = {}) {
  const { AppointmentReview, Appointment, User } = require("../../models");
  return AppointmentReview.findAll({
    where: { createdAt: { [Op.gte]: new Date(Date.now() - days * 86400000) } },
    include: [
      { model: Appointment, attributes: ["id", "date", "dietitionId"], required: true, where },
      { model: User, as: "Reviewer", attributes: ["id", "firstName", "lastName"] },
    ],
    order: [["createdAt", "DESC"]],
  });
}

exports.myRatings = async (req, res) => {
  try {
    const me = req.user && req.user.id;
    const type = String((req.user && req.user.userType) || "").trim().toLowerCase();
    if (!me || type === "user" || type === "") return res.json(ApiResponse("0", "Only for dietitians", {}));
    const days = daysOf(req);
    const rows = await reviewsSince(days, { dietitionId: me });
    const notes = rows
      .map((r) => ({ rating: r.rating, note: splitComment(r.comment).note, at: r.createdAt }))
      .filter((x) => x.note)
      .slice(0, 8);
    return res.json(ApiResponse("1", "Ratings", { days, ...summarize(rows), notes }));
  } catch (err) {
    console.error("[consultRatings] me:", err.message);
    return res.json(ApiResponse("0", "Couldn't load your ratings.", {}));
  }
};

exports.allRatings = async (req, res) => {
  try {
    const { User } = require("../../models");
    const days = daysOf(req);
    const rows = await reviewsSince(days);
    const byDiet = new Map();
    for (const r of rows) {
      const id = r.Appointment.dietitionId;
      if (!byDiet.has(id)) byDiet.set(id, []);
      byDiet.get(id).push(r);
    }
    const ids = [...byDiet.keys()];
    const diets = ids.length
      ? await User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ["id", "firstName", "lastName"] })
      : [];
    const nameOf = (u) => (u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "") || "—";
    const dietName = new Map(diets.map((u) => [u.id, nameOf(u)]));
    const dietitians = ids
      .map((id) => {
        const s = summarize(byDiet.get(id));
        return {
          dietitianId: id,
          name: dietName.get(id) || "—",
          average: s.average,
          count: s.count,
          low: byDiet.get(id).filter((r) => r.rating <= 2).length,
          improve: s.improve.slice(0, 3),
        };
      })
      .sort((a, b) => (a.average ?? 9) - (b.average ?? 9));
    const low = rows
      .filter((r) => r.rating <= 2)
      .slice(0, 30)
      .map((r) => {
        const c = splitComment(r.comment);
        return {
          reviewId: r.id,
          appointmentId: r.appointmentId,
          rating: r.rating,
          tags: c.tags,
          note: c.note,
          client: r.Reviewer ? { id: r.Reviewer.id, name: nameOf(r.Reviewer) } : null,
          dietitian: dietName.get(r.Appointment.dietitionId) || "—",
          at: r.createdAt,
        };
      });
    return res.json(ApiResponse("1", "Ratings", { days, overall: summarize(rows), dietitians, low }));
  } catch (err) {
    console.error("[consultRatings] all:", err.message);
    return res.json(ApiResponse("0", "Couldn't load ratings.", {}));
  }
};
