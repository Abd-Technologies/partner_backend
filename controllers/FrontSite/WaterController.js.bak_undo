const ApiResponse = require("../../helper/ApiResponse");
const { WaterLog, WeeklyCheckin, UserCycleData } = require("../../models");
const { calculateWaterTargetMl } = require("../../helper/WaterTargetCalculator");
const CyclePhase = require("../../helper/CyclePhaseCalculator");

function todayDateOnly() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Shared between POST /users/water_log, GET /users/water_log/today, and the
// DashboardController. Never throws — on internal failure returns a safe
// default with target derived from the fallback weight/phase inside the
// calculator. Keeps the dashboard Promise.allSettled tolerant.
async function computeHydrationSummary(userId) {
  const dateStr = todayDateOnly();

  // Today's water total.
  let consumedMl = 0;
  try {
    const logs = await WaterLog.findAll({
      where: { userId, date: dateStr },
      attributes: ["amountMl"],
    });
    consumedMl = logs.reduce((sum, l) => sum + (l.amountMl || 0), 0);
  } catch (err) {
    console.error("computeHydrationSummary: water sum failed:", err);
  }

  // Latest weight from WeeklyCheckin.
  let weightKg = null;
  try {
    const latest = await WeeklyCheckin.findOne({
      where: { userId },
      order: [["weekDate", "DESC"]],
      attributes: ["weightKg"],
    });
    weightKg = latest ? latest.weightKg : null;
  } catch (err) {
    console.error("computeHydrationSummary: weight lookup failed:", err);
  }

  // Current cycle phase (may be null for users with no cycle data).
  let phase = null;
  try {
    const cycleRow = await UserCycleData.findOne({ where: { userId } });
    if (cycleRow && cycleRow.lastPeriodDate && cycleRow.dataProvided === 1) {
      const info = CyclePhase.calculate({
        lastPeriodDate: cycleRow.lastPeriodDate,
        averageCycleLength: cycleRow.averageCycleLength || 28,
      });
      phase = info ? info.phase : null;
    }
  } catch (err) {
    console.error("computeHydrationSummary: cycle lookup failed:", err);
  }

  const targetMl = calculateWaterTargetMl(weightKg, phase);
  const remainingMl = Math.max(0, targetMl - consumedMl);

  return {
    date: dateStr,
    consumedMl,
    targetMl,
    remainingMl,
  };
}

// POST /users/water_log — body: { amountMl }
async function logWater(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

  const amountMl = Number(req.body && req.body.amountMl);
  if (!Number.isInteger(amountMl) || amountMl < 1 || amountMl > 3000) {
    return res.json(
      ApiResponse("0", "amountMl must be an integer between 1 and 3000", {})
    );
  }

  try {
    await WaterLog.create({
      userId,
      date: todayDateOnly(),
      amountMl,
    });
    const summary = await computeHydrationSummary(userId);
    return res.json(ApiResponse("1", "Logged", summary));
  } catch (err) {
    console.error("WaterController.logWater:", err);
    return res.json(ApiResponse("0", "Internal server error", {}));
  }
}

// GET /users/water_log/today — no body
async function getToday(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

  try {
    const summary = await computeHydrationSummary(userId);
    return res.json(ApiResponse("1", "Today's hydration", summary));
  } catch (err) {
    console.error("WaterController.getToday:", err);
    return res.json(ApiResponse("0", "Internal server error", {}));
  }
}

module.exports = {
  logWater,
  getToday,
  computeHydrationSummary,
};
