// Backend port of the Flutter CycleEngine (lib/data/services/cycle_engine.dart)
// and the inline logic in FrontSite/userController.save_cycle_data. Computes
// {cycleDay, phase} from a stored lastPeriodDate + averageCycleLength.
// Returns null when lastPeriodDate is missing.
function calculate({ lastPeriodDate, averageCycleLength = 28, today = null }) {
  if (!lastPeriodDate) return null;

  const now = today ? new Date(today) : new Date();
  const start = new Date(lastPeriodDate);

  // Day-only diff (local, matches the Flutter engine's behavior).
  const dayMs = 24 * 60 * 60 * 1000;
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const daysSince = Math.floor((a - b) / dayMs);

  const length = averageCycleLength || 28;
  let cycleDay;
  if (daysSince >= length) {
    // Period is late — continue counting, do NOT modulo. Phase stays 'luteal'.
    cycleDay = daysSince + 1;
  } else {
    cycleDay = (daysSince % length) + 1;
  }

  const menstrualEnd = Math.round(length * 0.18);
  const follicularEnd = Math.round(length * 0.46);
  const ovulatoryEnd = Math.round(length * 0.57);

  let phase;
  if (cycleDay <= menstrualEnd) phase = "menstrual";
  else if (cycleDay <= follicularEnd) phase = "follicular";
  else if (cycleDay <= ovulatoryEnd) phase = "ovulatory";
  else phase = "luteal";

  return { cycleDay, phase };
}

module.exports = { calculate };
