// Class feedback (see helper/classFeedback.js for the rules).
//   Client  GET  /attendance/feedback/pending   → the class to rate, or null
//           POST /attendance/feedback           → { slotId, classDate, rating, tags?, comment?, final? }
//           POST /attendance/feedback/skip      → { slotId, classDate }
//   Trainer GET  /attendance/feedback/trainer   → her average + tag counts (no client names)
//   Admin   GET  /admin/classFeedback           → low ratings + every trainer's average
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const ApiResponse = require("../../helper/ApiResponse");
const { ClassFeedback, User, Slot } = require("../../models");
const { GOOD_TAGS, BAD_TAGS, pendingFor, findClass, fullName } = require("../../helper/classFeedback");
const sendNotification = require("../../helper/notification");
const { isAdmin, isTrainer, adminsOnlyMessage } = require("../../helper/roles");

const ADMIN = process.env.ADMIN || "Admin";
const TRAINER = process.env.TRAINER || "Trainer";
const ALERT_AT_OR_BELOW = 2;

const me = (req) =>
  req.user && req.user.id
    ? User.findByPk(req.user.id, { attributes: ["id", "firstName", "lastName", "userType", "timeZone"] })
    : null;

const cleanTags = (tags, rating) => {
  const allowed = rating >= 4 ? GOOD_TAGS : BAD_TAGS;
  return Array.isArray(tags) ? [...new Set(tags.filter((t) => allowed.includes(t)))] : [];
};

async function alertAdmins(row, client, trainerName) {
  try {
    const admins = await User.findAll({
      where: { userType: ADMIN, deviceToken: { [Op.ne]: null } },
      attributes: ["deviceToken"],
    });
    const tokens = admins.map((a) => a.deviceToken).filter(Boolean);
    if (!tokens.length) return;
    const tags = row.tagList();
    await sendNotification(
      tokens,
      {
        title: `${row.rating}★ class feedback · ${row.className || "class"} with ${trainerName}`,
        body: `${fullName(client) || "A client"}${tags.length ? ": " + tags.join(", ") : ""}${row.comment ? ` · "${row.comment}"` : ""}`,
      },
      { type: "classFeedbackLow", feedbackId: String(row.id) }
    );
  } catch (e) {
    console.error("[class-feedback] admin alert failed:", e.message);
  }
}

exports.pending = async (req, res) => {
  try {
    const user = await me(req);
    if (!user) return res.json(ApiResponse("0", "Unauthorized", {}));
    const pending = await pendingFor(user.id, user.timeZone);
    return res.json(ApiResponse("1", "ok", { pending }));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};

exports.submit = async (req, res) => {
  try {
    const user = await me(req);
    if (!user) return res.json(ApiResponse("0", "Unauthorized", {}));
    const { slotId, classDate, comment } = req.body || {};
    const rating = Number(req.body && req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.json(ApiResponse("0", "Rating must be 1 to 5", {}));
    }
    const c = await findClass(user.id, slotId, classDate);
    if (!c) return res.json(ApiResponse("0", "We couldn't find this class", {}));

    const where = { userId: user.id, slotId: c.slot.id, classDate: c.classDate };
    let row = await ClassFeedback.findOne({ where });
    if (!row) {
      row = ClassFeedback.build({
        ...where,
        trainerId: c.slot.trainerId || null,
        className: (c.slot.type || "class").trim().slice(0, 120),
        minutesAttended: Math.round(c.seconds / 60),
      });
    }
    row.rating = rating;
    row.skipped = false;
    if (req.body.tags !== undefined) row.tags = JSON.stringify(cleanTags(req.body.tags, rating));
    if (comment !== undefined) row.comment = String(comment || "").trim().slice(0, 1000) || null;
    if (req.body.final) row.final = true;
    await row.save();

    if (row.final && rating <= ALERT_AT_OR_BELOW && !row.alertedAt) {
      row.alertedAt = new Date();
      await row.save();
      alertAdmins(row, user, fullName(c.slot.User) || "trainer");
    }
    return res.json(ApiResponse("1", "Thank you for your feedback", { id: row.id }));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};

exports.skip = async (req, res) => {
  try {
    const user = await me(req);
    if (!user) return res.json(ApiResponse("0", "Unauthorized", {}));
    const { slotId, classDate } = req.body || {};
    const c = await findClass(user.id, slotId, classDate);
    if (!c) return res.json(ApiResponse("1", "ok", {}));
    await ClassFeedback.findOrCreate({
      where: { userId: user.id, slotId: c.slot.id, classDate: c.classDate },
      defaults: {
        trainerId: c.slot.trainerId || null,
        className: (c.slot.type || "class").trim().slice(0, 120),
        skipped: true,
        final: true,
        minutesAttended: Math.round(c.seconds / 60),
      },
    });
    return res.json(ApiResponse("1", "ok", {}));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};

function summarize(rows) {
  const rated = rows.filter((r) => r.rating != null);
  const count = rated.length;
  const avg = count ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : null;
  const good = {};
  const bad = {};
  for (const r of rated) {
    for (const t of r.tagList()) {
      const bucket = r.rating >= 4 ? good : bad;
      bucket[t] = (bucket[t] || 0) + 1;
    }
  }
  const sorted = (o) => Object.entries(o).map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count);
  const stars = [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: rated.filter((r) => r.rating === s).length }));
  return { average: avg, count, loved: sorted(good), improve: sorted(bad), stars };
}

const sinceDate = (req) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  return { days, since: moment.tz("Asia/Karachi").subtract(days, "days").format("YYYY-MM-DD") };
};

/** Trainer: her own summary. No client names, so clients stay honest. */
exports.trainerSummary = async (req, res) => {
  try {
    const user = await me(req);
    if (!isTrainer(user)) return res.json(ApiResponse("0", "Trainers only", {}));
    const { days, since } = sinceDate(req);
    const rows = await ClassFeedback.findAll({
      where: { trainerId: user.id, classDate: { [Op.gte]: since }, rating: { [Op.ne]: null } },
    });
    return res.json(ApiResponse("1", "ok", { days, ...summarize(rows) }));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};

/** Admin: low ratings (with names) + every trainer's average. */
exports.adminList = async (req, res) => {
  try {
    const user = await me(req);
    if (!isAdmin(user)) return res.json(ApiResponse("0", adminsOnlyMessage(user), {}));
    const { days, since } = sinceDate(req);
    const where = { classDate: { [Op.gte]: since }, rating: { [Op.ne]: null } };
    if (req.query.trainerId) where.trainerId = Number(req.query.trainerId);
    const rows = await ClassFeedback.findAll({
      where,
      order: [["classDate", "DESC"], ["updatedAt", "DESC"]],
      include: [
        { model: User, as: "client", attributes: ["id", "firstName", "lastName"] },
        { model: User, as: "trainer", attributes: ["id", "firstName", "lastName"] },
      ],
    });
    const byTrainer = new Map();
    for (const r of rows) {
      const k = r.trainerId || 0;
      if (!byTrainer.has(k)) byTrainer.set(k, { trainerId: k, name: fullName(r.trainer) || "No trainer", rows: [] });
      byTrainer.get(k).rows.push(r);
    }
    const trainers = [...byTrainer.values()]
      .map((t) => ({ trainerId: t.trainerId, name: t.name, ...summarize(t.rows) }))
      .sort((a, b) => (a.average ?? 9) - (b.average ?? 9));
    const low = rows
      .filter((r) => r.rating <= 3)
      .slice(0, 100)
      .map((r) => ({
        id: r.id,
        rating: r.rating,
        classDate: r.classDate,
        className: r.className,
        client: fullName(r.client),
        clientId: r.userId,
        trainer: fullName(r.trainer),
        tags: r.tagList(),
        comment: r.comment,
        minutesAttended: r.minutesAttended,
      }));
    return res.json(ApiResponse("1", "ok", { days, overall: summarize(rows), trainers, low }));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};
