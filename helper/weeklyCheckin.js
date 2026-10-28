// One weekly check-in (Oct 2026). Replaces the Day 7 review, Day 15
// progress and Day 30 progress pop-ups with one check-in every 7 days.
//
// Timing: every 7 days from when her first diet plan was shared
// (UserPlan.firstPlanDeliveredAt). Workout-only plan: from the plan start
// (buyingDate). Day 7, 14, 21, 28, ...  A skipped week is dropped: the
// next week's check-in takes its place.
//
// What she is asked:
//   every week  weight (required), waist/hips/chest/arms/thighs (optional),
//               "How was your week?" (one tap)
//   plan qs     week 1 and the milestone weeks: the Day 7 review questions
//               (diet part only with a diet plan, workout part only with a
//               workout plan). Saved as a Day7Review too, so its alerts to
//               the dietitian/admin keep working.
//   milestone   "halfway" (day 14 on) until a Day 15 ProgressSubmission
//               exists: clothes fit, sleep, satisfaction (+ photos on her
//               phone). Saved as ProgressSubmission cycle 15, so the
//               follow-up unlock keeps working.
//               "end" (day 28 on, or the last check-in before the package
//               ends, from day 14): saved as ProgressSubmission cycle 30.
const { Op } = require("sequelize");
const { planTypeOf } = require("./planKind");

const DAY_MS = 86400000;
const EVERY_DAYS = 7;

const FEEL = { 1: "Hard", 2: "Okay", 3: "Good", 4: "Great" };
// "How was your week?" → Day7Review.satisfaction (1..5). "Hard" (1) is
// below 2, so it alerts like a low score does today.
const FEEL_TO_SATISFACTION = { 1: 1, 2: 3, 3: 4, 4: 5 };

function isRealPlan(p) {
  const t = String((p.Plan && p.Plan.title) || "").trim().toLowerCase();
  if (p.isTrial) return false;
  if (!t || t === "free trial" || t.startsWith("system")) return false;
  return true;
}

async function livePlanFor(userId) {
  const { UserPlan, Plan } = require("../models");
  const { activeUserPlanWhere } = require("./activePackage");
  const rows = await UserPlan.findAll({
    where: { userId, ...activeUserPlanWhere() },
    include: [{ model: Plan, attributes: ["id", "title", "CategoryId", "planType"] }],
    order: [["buyingDate", "DESC"]],
  });
  return rows.find(isRealPlan) || null;
}

function measurementsOf(row) {
  if (!row) return null;
  return {
    date: row.updatedAt || row.createdAt,
    weightKg: row.weightKg,
    waistCm: row.waistCm,
    hipsCm: row.hipCm,
    chestCm: row.chestCm,
    armsCm: row.armsCm,
    thighsCm: row.thighsCm,
  };
}

// Everything the app needs to show the card and the check-in.
async function startAndLast(userId) {
  const { WeeklyCheckin } = require("../models");
  const [first, latest, count] = await Promise.all([
    WeeklyCheckin.findOne({
      where: { userId, weightKg: { [Op.ne]: null } },
      order: [["weekDate", "ASC"], ["createdAt", "ASC"]],
    }),
    WeeklyCheckin.findOne({
      where: { userId, weightKg: { [Op.ne]: null } },
      order: [["weekDate", "DESC"], ["updatedAt", "DESC"]],
    }),
    WeeklyCheckin.count({ where: { userId, checkinDay: { [Op.ne]: null } } }),
  ]);
  return { start: measurementsOf(first), last: measurementsOf(latest), checkinsDone: count };
}

async function stateFor(userId) {
  const { WeeklyCheckin, ProgressSubmission } = require("../models");
  const plan = await livePlanFor(userId);
  // start / last are sent in every case, so "Log measurements" can show
  // last time's values even when no check-in is due.
  if (!plan) return { due: false, reason: "no_plan", ...(await startAndLast(userId)) };

  const planType = planTypeOf(plan.Plan) || "diet";
  const diet = planType === "diet" || planType === "combined";
  const workout = planType === "workout" || planType === "combined";
  // Diet (or both): from the first shared diet plan. Workout only: from the
  // plan start.
  const anchorRaw = diet ? plan.firstPlanDeliveredAt : plan.buyingDate;
  if (!anchorRaw) return { due: false, reason: "plan_not_shared", planType, ...(await startAndLast(userId)) };
  const anchor = new Date(anchorRaw);
  const days = Math.floor((Date.now() - anchor.getTime()) / DAY_MS);
  const k = Math.floor(days / EVERY_DAYS);
  if (k < 1) {
    return {
      due: false,
      reason: "too_early",
      planType,
      nextOn: new Date(anchor.getTime() + EVERY_DAYS * DAY_MS).toISOString(),
      ...(await startAndLast(userId)),
    };
  }
  const checkinDay = k * EVERY_DAYS;
  const windowStart = new Date(anchor.getTime() + checkinDay * DAY_MS);
  const windowEnd = new Date(windowStart.getTime() + EVERY_DAYS * DAY_MS);

  const [doneRow, half, end, sl] = await Promise.all([
    WeeklyCheckin.findOne({ where: { userId, userPlanId: plan.id, checkinDay } }),
    ProgressSubmission.findOne({ where: { userPlanId: plan.id, cycle: 15 } }),
    ProgressSubmission.findOne({ where: { userPlanId: plan.id, cycle: 30 } }),
    startAndLast(userId),
  ]);

  const lastWindow = plan.expireDate && new Date(plan.expireDate) < windowEnd;
  let milestone = null;
  if (!end && (k >= 4 || (lastWindow && k >= 2))) milestone = "end";
  else if (!half && k >= 2) milestone = "halfway";

  const label = milestone || (k === 1 ? "week1" : "weekly");
  const planQuestions = k === 1 || milestone != null;

  return {
    due: !doneRow,
    label, // week1 | weekly | halfway | end
    checkinDay,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    userPlanId: plan.id,
    planType,
    sections: {
      diet: planQuestions && diet,
      workout: planQuestions && workout,
      milestone,
    },
    // "end" closes the package (renew) only in its last week.
    endOfPackage: milestone === "end" && !!lastWindow,
    ...sl,
  };
}

// Progress tab history: her weigh-ins and measurements, oldest first.
async function historyFor(userId, limit = 12) {
  const { WeeklyCheckin } = require("../models");
  const rows = await WeeklyCheckin.findAll({
    where: {
      userId,
      [Op.or]: [
        { weightKg: { [Op.ne]: null } },
        { waistCm: { [Op.ne]: null } },
        { hipCm: { [Op.ne]: null } },
        { chestCm: { [Op.ne]: null } },
        { armsCm: { [Op.ne]: null } },
        { thighsCm: { [Op.ne]: null } },
      ],
    },
    order: [["weekDate", "DESC"]],
    limit,
  });
  return rows.reverse().map((r) => ({
    weekDate: r.weekDate,
    ...measurementsOf(r),
    weekRating: r.weekRating,
  }));
}

module.exports = { stateFor, historyFor, FEEL, FEEL_TO_SATISFACTION, EVERY_DAYS };
