// Water target (ml) computed on read, never stored. Base is 33 ml/kg with a
// fallback weight of 60 kg when the user has no weekly check-ins yet. Cycle
// phase nudges the number up (luteal retention) or down (menstrual) slightly.
// Final value is rounded to the nearest 100 and clamped [1000, 5000].
function calculateWaterTargetMl(weightKg, cyclePhase) {
  const base = Math.round((weightKg || 60) * 33);

  let adjusted = base;
  if (cyclePhase === "luteal") adjusted += 200;
  else if (cyclePhase === "ovulatory") adjusted += 100;
  else if (cyclePhase === "menstrual") adjusted -= 100;

  const rounded = Math.round(adjusted / 100) * 100;
  return Math.max(1000, Math.min(5000, rounded));
}

module.exports = { calculateWaterTargetMl };
