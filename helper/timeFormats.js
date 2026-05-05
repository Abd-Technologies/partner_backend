const moment = require("moment-timezone");

// Canonical timezone for all wall-clock slot/appointment data.
// Both Slot.start/end (trainer) and SlotDiet.start/end (dietitian) are
// stored as PKT-local strings; crons anchor "now" to this zone too.
const CANONICAL_TZ = "Asia/Karachi";

// Slot.end / SlotDiet.end can be in three formats across live data history:
//   • millisecond Unix timestamps   (legacy admin save)
//   • 24-hour UTC HH:mm             (intermediate format from tz refactor)
//   • 12-hour AM/PM, PKT-local      (current canonical)
// Returns the UTC moment when this slot ends, or null if unparseable.
// [anchorPkt] is a moment in [CANONICAL_TZ] used to anchor the wall-clock
// inputs to a real calendar date — passing it in keeps the function pure.
// Trainer crons pass "today PKT"; dietitian appointment crons pass the
// PKT moment derived from Appointment.date so a future-dated appointment
// is anchored to its own day, not today.
function parseEndAsUtc(s, anchorPkt) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();

  if (/^\d+$/.test(t) && t.length >= 10) {
    const ms = parseInt(t, 10);
    if (Number.isFinite(ms) && ms > 0) return moment.utc(ms);
    return null;
  }

  // 24-hour HH:mm — historical UTC interpretation (pre-canonicalization).
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return moment.utc().startOf("day").hour(hours).minute(minutes);
  }

  // 12-hour AM/PM — canonical, interpreted as PKT-local.
  m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (m) {
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const isPm = m[3].toUpperCase() === "PM";
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return anchorPkt
      .clone()
      .startOf("day")
      .hour(hours)
      .minute(minutes)
      .utc();
  }
  return null;
}

module.exports = { CANONICAL_TZ, parseEndAsUtc };
