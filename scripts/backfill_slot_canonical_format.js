// Class slots: convert old start/end values to the canonical "hh:mm A"
// Pakistan-time format (Oct 2026).
//
// Why: some servers still have class times saved the old way, as
// millisecond timestamps ("1776394800000"). The app's Workout screen can
// read those, but the server's Home class list, class reminders and the
// late-class auto-cancel only read "08:00 AM" style times, so on those
// servers Home showed no upcoming classes and reminders never went out.
//
// Safe: only rows that aren't already canonical are changed; placeholders
// ("Start Time") are left alone. Saving the weekly schedule in the admin
// panel already writes the canonical format, so this is a one-time fix.
//
//   node scripts/backfill_slot_canonical_format.js          → preview only
//   node scripts/backfill_slot_canonical_format.js --apply  → save changes
require("dotenv").config();
const { Slot, Time } = require("../models");
const { normalizeSlotTime } = require("../helper/normalizeSlotTime");

const CANON = /^\d{2}:\d{2} (AM|PM)$/;

(async () => {
  const apply = process.argv.includes("--apply");
  const slots = await Slot.findAll({ include: [{ model: Time, attributes: ["day"] }] });
  let changed = 0;
  let bad = 0;
  for (const s of slots) {
    const ns = CANON.test(String(s.start || "")) ? s.start : normalizeSlotTime(s.start);
    const ne = CANON.test(String(s.end || "")) ? s.end : normalizeSlotTime(s.end);
    if (ns === s.start && ne === s.end) continue;
    if (!ns || !ne) {
      bad++;
      console.log(`  ?? slot ${s.id} (${s.Time && s.Time.day}): can't read "${s.start}" – "${s.end}", left as is`);
      continue;
    }
    changed++;
    console.log(`  slot ${s.id} ${s.Time && s.Time.day} ${s.type || ""}: "${s.start}" – "${s.end}"  →  ${ns} – ${ne}`);
    if (apply) await s.update({ start: ns, end: ne });
  }
  console.log(`\n${slots.length} slots checked, ${changed} ${apply ? "updated" : "would be updated"}, ${bad} unreadable.`);
  if (!apply && changed) console.log("Preview only. Run again with --apply to save.");
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
