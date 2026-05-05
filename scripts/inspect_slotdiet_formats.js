// Read-only audit of SlotDiet.start / SlotDiet.end string formats.
//
// Mirrors the three formats the trainer-side parser handles
// (helper/autoEndSessions.js → parseEndAsUtc):
//   • millisecond Unix timestamp (legacy)
//   • 24-hour HH:mm              (intermediate)
//   • 12-hour AM/PM              (canonical, PKT-local)
//
// Run before deciding the canonical SlotDiet time format and writing any
// migration. Writes nothing.
//
// Usage:
//   node partner_backend/scripts/inspect_slotdiet_formats.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const db = require('../models');
const { SlotDiet } = db;

const RE_MS_TIMESTAMP = /^\d{10,}$/;
const RE_24H = /^(\d{1,2}):(\d{2})$/;
const RE_12H_AMPM = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/;

function classify(raw) {
  if (raw == null) return 'null';
  if (typeof raw !== 'string') return `non_string(${typeof raw})`;
  const t = raw.trim();
  if (t === '') return 'empty';
  if (RE_MS_TIMESTAMP.test(t)) return 'ms_timestamp';
  if (RE_24H.test(t)) {
    const [, h, m] = t.match(RE_24H);
    const hh = parseInt(h, 10);
    const mm = parseInt(m, 10);
    if (hh > 23 || mm > 59) return 'malformed_24h';
    return '24h_HHmm';
  }
  if (RE_12H_AMPM.test(t)) return '12h_ampm';
  return 'other';
}

function summarize(rows, column) {
  const buckets = new Map();
  for (const row of rows) {
    const raw = row[column];
    const bucket = classify(raw);
    if (!buckets.has(bucket)) {
      buckets.set(bucket, { count: 0, samples: new Set() });
    }
    const b = buckets.get(bucket);
    b.count++;
    if (b.samples.size < 5) b.samples.add(raw);
  }
  return buckets;
}

function printBuckets(label, buckets, total) {
  console.log(`\n${label}  (total rows: ${total})`);
  const sorted = [...buckets.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [bucket, info] of sorted) {
    const pct = total ? ((info.count / total) * 100).toFixed(1) : '0.0';
    console.log(`  ${bucket.padEnd(18)} ${String(info.count).padStart(6)}  (${pct}%)`);
    const samples = [...info.samples]
      .map((s) => (s === null ? 'NULL' : JSON.stringify(s)))
      .join(', ');
    if (samples) console.log(`    samples: ${samples}`);
  }
}

async function main() {
  const rows = await SlotDiet.findAll({
    attributes: ['id', 'dietitionId', 'TimeDietitionId', 'start', 'end'],
    raw: true,
  });

  const total = rows.length;
  console.log(`SlotDiet rows: ${total}`);
  if (total === 0) {
    console.log('No SlotDiet rows found. Nothing to audit.');
    return;
  }

  const distinctDietitians = new Set(rows.map((r) => r.dietitionId)).size;
  const distinctDays = new Set(rows.map((r) => r.TimeDietitionId)).size;
  console.log(`Distinct dietitionIds: ${distinctDietitians}`);
  console.log(`Distinct TimeDietitionIds (day rows): ${distinctDays}`);

  const startBuckets = summarize(rows, 'start');
  const endBuckets = summarize(rows, 'end');
  printBuckets('start format breakdown', startBuckets, total);
  printBuckets('end format breakdown', endBuckets, total);

  // Cross-format check: is start in one bucket and end in another on the
  // same row? That would mean we can't migrate by single-column passes.
  const mismatches = [];
  for (const row of rows) {
    const sb = classify(row.start);
    const eb = classify(row.end);
    if (sb !== eb) {
      mismatches.push({ id: row.id, start: row.start, end: row.end, sb, eb });
      if (mismatches.length >= 10) break;
    }
  }
  console.log(`\nstart/end bucket mismatches on same row: ${mismatches.length}${mismatches.length === 10 ? '+ (sample capped)' : ''}`);
  for (const m of mismatches) {
    console.log(`  id=${m.id}  start=${JSON.stringify(m.start)} (${m.sb})  end=${JSON.stringify(m.end)} (${m.eb})`);
  }

  // Range sanity (only meaningful for buckets we can parse). For 24h and
  // 12h-AMPM, flag rows where end <= start.
  const inverted = [];
  for (const row of rows) {
    const sb = classify(row.start);
    const eb = classify(row.end);
    if (sb !== eb) continue;
    let sMin = null, eMin = null;
    if (sb === '24h_HHmm') {
      const [, sh, sm] = row.start.trim().match(RE_24H);
      const [, eh, em] = row.end.trim().match(RE_24H);
      sMin = parseInt(sh, 10) * 60 + parseInt(sm, 10);
      eMin = parseInt(eh, 10) * 60 + parseInt(em, 10);
    } else if (sb === '12h_ampm') {
      const parse12 = (s) => {
        const [, h, m, ap] = s.trim().match(RE_12H_AMPM);
        let hh = parseInt(h, 10);
        const mm = parseInt(m, 10);
        const isPm = ap.toUpperCase() === 'PM';
        if (hh === 12) hh = isPm ? 12 : 0;
        else if (isPm) hh += 12;
        return hh * 60 + mm;
      };
      sMin = parse12(row.start);
      eMin = parse12(row.end);
    } else {
      continue;
    }
    if (eMin <= sMin) {
      inverted.push({ id: row.id, start: row.start, end: row.end });
      if (inverted.length >= 10) break;
    }
  }
  console.log(`\nrows where end <= start (parseable buckets only): ${inverted.length}${inverted.length === 10 ? '+ (sample capped)' : ''}`);
  for (const r of inverted) {
    console.log(`  id=${r.id}  ${JSON.stringify(r.start)} → ${JSON.stringify(r.end)}`);
  }

  console.log('\nDone. No rows written.');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Audit failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      try { await db.sequelize.close(); } catch (_) {}
    });
}

module.exports = { classify };
