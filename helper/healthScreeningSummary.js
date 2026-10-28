// Symptom check (PCOS / thyroid / menopause / postpartum / endometriosis
// screening) — latest result per condition, for the home card, the
// dietitian's client profile and the Growth upsell list.
const RISK_ORDER = { high: 3, moderate: 2, low: 1 };

async function latestByCondition(userId, { withAnswers = false } = {}) {
  const { HealthScreening } = require("../models");
  const rows = await HealthScreening.findAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
    limit: 50,
  });
  const seen = new Map();
  for (const r of rows) {
    if (seen.has(r.conditionType)) continue;
    let answers = null;
    if (withAnswers) {
      try {
        answers = r.answers ? JSON.parse(r.answers) : null;
      } catch (_) {}
    }
    seen.set(r.conditionType, {
      conditionType: r.conditionType,
      riskLevel: r.riskLevel || "low",
      riskScore: r.riskScore || 0,
      takenAt: r.createdAt,
      dietitianNotifiedAt: r.dietitianNotifiedAt || null,
      ...(withAnswers ? { answers } : {}),
    });
  }
  const list = [...seen.values()];
  // Most important first: highest risk, then newest.
  list.sort(
    (a, b) =>
      (RISK_ORDER[b.riskLevel] || 0) - (RISK_ORDER[a.riskLevel] || 0) ||
      new Date(b.takenAt) - new Date(a.takenAt)
  );
  return list;
}

module.exports = { latestByCondition, RISK_ORDER };
