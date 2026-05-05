// Monday-start week helper. Used by signup auto-creating a WeeklyCheckin and
// by the weight-log endpoint so both write to the same row for the same week
// (preserves the unique (userId, weekDate) index semantics). Uses local
// calendar — weeks are a calendar concept, not a UTC concept.
//
// getDay(): 0 = Sunday, 1 = Monday, ..., 6 = Saturday
// Offset map: Sun → -6, Mon → 0, Tue → -1, Wed → -2, Thu → -3, Fri → -4, Sat → -5
//
// Examples (verified):
//   Friday   2026-04-24 → "2026-04-20"
//   Sunday   2026-04-26 → "2026-04-20"
//   Monday   2026-04-27 → "2026-04-27"
function currentWeekMonday(from = new Date()) {
  const day = from.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  // Clone to avoid mutating the caller's Date. setDate handles month/year rollover.
  const monday = new Date(from);
  monday.setDate(monday.getDate() + offset);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

module.exports = { currentWeekMonday };
