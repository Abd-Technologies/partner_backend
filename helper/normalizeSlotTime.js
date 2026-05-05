const moment = require("moment-timezone");

const CANONICAL_TZ = "Asia/Karachi";

// Canonical Slot.start / Slot.end format: 12-hour wall-clock string in PKT,
// e.g. "08:00 AM" / "08:50 AM". The team made this the source-of-truth
// format because:
//   1. It's human-readable when eyeballing the DB.
//   2. The Flutter parsers (workout schedule + dashboard) accept it
//      directly.
//   3. The timezone-aware response converters already treat AM/PM strings
//      as PKT-local and convert to the requesting user's tz.
//
// This helper coerces every legacy format we've seen in the live DB:
//   • millisecond Unix timestamps  ("1777672800000")  ← legacy admin save
//   • 24-hour UTC HH:mm            ("03:00")          ← intermediate fmt
//   • already-canonical AM/PM      ("08:00 AM")       ← target format
// into the canonical form. Placeholders ("Start Time" / "End Time") are
// passed through unchanged so the existing "is this slot real?" filter
// in workout_plan_details still works.
function normalizeSlotTime(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (s === "Start Time" || s === "End Time") return s;

  // ms timestamp (legacy)
  if (/^\d+$/.test(s) && s.length >= 10) {
    const n = parseInt(s, 10);
    if (Number.isFinite(n) && n > 0) {
      return moment.tz(n, CANONICAL_TZ).format("hh:mm A");
    }
  }

  // already 12-hour AM/PM — re-format to enforce zero-padding & casing.
  let m = s.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (m) {
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const isPm = m[3].toUpperCase() === "PM";
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return moment
      .tz(CANONICAL_TZ)
      .startOf("day")
      .hour(hours)
      .minute(minutes)
      .format("hh:mm A");
  }

  // 24-hour HH:mm — interpret as UTC (matches the in-flight timezone
  // refactor). Then convert to PKT and format AM/PM.
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return moment
      .utc()
      .startOf("day")
      .hour(hours)
      .minute(minutes)
      .tz(CANONICAL_TZ)
      .format("hh:mm A");
  }

  return null;
}

module.exports = { normalizeSlotTime, CANONICAL_TZ };
