// Symptom check for PAID clients (fitHer Flows › Hormone check):
//   notifyDietitian()   "Tell my dietitian" + automatic when signs went up
//   trackingInfo()      known condition → "Track my PCOS signs", trend vs last time
//   sendMonthlyReminders()  one push a month to paid women who track a condition
const { Op } = require("sequelize");
const moment = require("moment-timezone");

const CONDITIONS = ["PCOS", "Thyroid", "Menopause", "Postpartum", "Endometriosis"];
const M = () => require("../models");
const DAY = 24 * 3600 * 1000;

/** Her dietitian: active diet plan → plan/package → last appointment. */
async function resolveDietitianId(userId) {
  const { DietPlan, UserPlan, Plan, Appointment } = M();
  try {
    const dp = await DietPlan.findOne({
      where: { userId, status: "active" },
      attributes: ["dietitianId"],
      order: [["createdAt", "DESC"]],
    });
    if (dp && dp.dietitianId) return dp.dietitianId;
  } catch (_) {}
  const up = await UserPlan.findOne({
    where: { userId, status: true, expireDate: { [Op.gte]: new Date() } },
    include: [{ model: Plan, attributes: ["dietitianId"] }],
    order: [["createdAt", "DESC"]],
  });
  if (up && (up.dietitianId || (up.Plan && up.Plan.dietitianId))) return up.dietitianId || up.Plan.dietitianId;
  try {
    const appt = await Appointment.findOne({ where: { userId }, order: [["createdAt", "DESC"]] });
    if (appt && appt.dietitionId) return appt.dietitionId;
  } catch (_) {}
  return null;
}

/**
 * Push to her dietitian about this screening (once per screening).
 * Returns { sent, dietitianName, reason }.
 */
async function notifyDietitian(screening, { auto = false, previousScore = null } = {}) {
  const { User } = M();
  if (!screening) return { sent: false, reason: "no_result" };
  if (screening.dietitianNotifiedAt) return { sent: true, already: true };
  const dietitianId = await resolveDietitianId(screening.userId);
  if (!dietitianId) return { sent: false, reason: "no_dietitian" };
  const [client, dietitian] = await Promise.all([
    User.findByPk(screening.userId, { attributes: ["id", "firstName", "lastName"] }),
    User.findByPk(dietitianId, { attributes: ["id", "firstName", "lastName", "deviceToken"] }),
  ]);
  if (!dietitian) return { sent: false, reason: "no_dietitian" };
  const name = client ? `${client.firstName || ""}`.trim() || "Your client" : "Your client";
  const risk = String(screening.riskLevel || "").replace(/^./, (c) => c.toUpperCase());
  const body = auto && previousScore != null
    ? `Her ${screening.conditionType} signs went up (${previousScore} → ${screening.riskScore}). Review before her next plan.`
    : `${risk} signs. She asked you to look at it before her next plan.`;
  if (dietitian.deviceToken) {
    try {
      await require("./notification")(
        [dietitian.deviceToken],
        { title: `${name}'s ${screening.conditionType} check`, body },
        { type: "clientScreening", userId: String(screening.userId) }
      );
    } catch (e) {
      console.warn("[screening] dietitian push failed:", e.message);
    }
  }
  screening.dietitianNotifiedAt = new Date();
  await screening.save();
  return { sent: true, dietitianName: `${dietitian.firstName || ""}`.trim() || null };
}

/** After a new screening: tell the dietitian automatically if signs went up. */
async function afterSaved(screening) {
  try {
    const { HealthScreening } = M();
    const prev = await HealthScreening.findOne({
      where: { userId: screening.userId, conditionType: screening.conditionType, id: { [Op.ne]: screening.id } },
      order: [["createdAt", "DESC"]],
    });
    if (!prev || (screening.riskScore || 0) <= (prev.riskScore || 0)) return;
    const { planTypeForUser } = require("./preConsultRequirements");
    const type = await planTypeForUser(screening.userId);
    if (type !== "diet" && type !== "combined") return;
    await notifyDietitian(screening, { auto: true, previousScore: prev.riskScore || 0 });
  } catch (e) {
    console.warn("[screening] afterSaved:", e.message);
  }
}

/**
 * For the home card: the condition she tracks (one she already has, from
 * her health conditions or an earlier moderate/high result) and her last
 * two scores for it.
 */
async function trackingInfo(userId) {
  const { User, HealthScreening } = M();
  const user = await User.findByPk(userId, { attributes: ["id", "healthConditions"] });
  const declared = String((user && user.healthConditions) || "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  let track = CONDITIONS.find((c) => declared.includes(c.toLowerCase())) || null;
  if (!track) {
    const flagged = await HealthScreening.findOne({
      where: { userId, riskLevel: { [Op.in]: ["moderate", "high"] } },
      order: [["createdAt", "DESC"]],
    });
    if (flagged) track = flagged.conditionType;
  }
  if (!track) return { known: null, history: [] };
  const rows = await HealthScreening.findAll({
    where: { userId, conditionType: track },
    order: [["createdAt", "DESC"]],
    limit: 2,
  });
  const history = rows.map((r) => ({
    riskLevel: r.riskLevel || "low",
    riskScore: r.riskScore || 0,
    takenAt: r.createdAt,
    dietitianNotifiedAt: r.dietitianNotifiedAt || null,
  }));
  const last = history[0];
  return {
    known: track,
    history,
    dueThisMonth: !last || Date.now() - new Date(last.takenAt).getTime() > 28 * DAY,
  };
}

/** Monthly "check your PCOS signs" push for paid women who track a condition. */
async function sendMonthlyReminders() {
  const { UserPlan, User, UserNotification, HealthScreening } = M();
  const live = await UserPlan.findAll({
    where: { status: true, isTrial: { [Op.not]: true }, frozenAt: null, cancelledAt: null, expireDate: { [Op.gte]: new Date() } },
    attributes: ["userId"],
  });
  const ids = [...new Set(live.map((p) => p.userId))];
  let sent = 0;
  for (const userId of ids) {
    try {
      const info = await trackingInfo(userId);
      if (!info.known || !info.dueThisMonth) continue;
      const recent = await UserNotification.findOne({
        where: { userId, type: "symptomCheckReminder", createdAt: { [Op.gte]: new Date(Date.now() - 30 * DAY) } },
        attributes: ["id"],
      });
      if (recent) continue;
      const user = await User.findByPk(userId, { attributes: ["id", "deviceToken"] });
      if (!user || !user.deviceToken) continue;
      const had = await HealthScreening.count({ where: { userId, conditionType: info.known } });
      await require("./notification")(
        [user.deviceToken],
        {
          title: `Your monthly ${info.known} check 💚`,
          body: had
            ? "2 minutes to see how your signs are changing with your plan."
            : `Track your ${info.known} signs: 2 minutes, then once a month.`,
        },
        { type: "symptomCheckReminder", condition: info.known }
      );
      sent++;
    } catch (e) {
      console.warn("[screening] reminder", userId, e.message);
    }
  }
  return sent;
}

module.exports = { notifyDietitian, afterSaved, trackingInfo, sendMonthlyReminders, resolveDietitianId, CONDITIONS };
