// Converts SlotDiet.start / SlotDiet.end rows from millisecond-timestamp
// format to the canonical 12-hour AM/PM PKT-local format ("h:mm A").
//
// Why:
//   The trainer side already uses canonical "h:mm A" PKT-local. The
//   dietitian side has two co-existing formats (audited via
//   inspect_slotdiet_formats.js): ~64% ms_timestamp legacy, ~36% canonical.
//   Without a uniform format, the new auto-end cron and any client-side
//   time rendering must keep parsing both — wasted complexity. Convert
//   once, then the parser is incidental rather than load-bearing.
//
// Idempotent: rows that already match /^\d{1,2}:\d{2}\s*[AP]M$/ are skipped.
// Rows with unparseable junk (other / null / empty) are skipped and reported.
//
// Usage:
//   node partner_backend/scripts/backfill_slotdiet_canonical_format.js              # dry run
//   node partner_backend/scripts/backfill_slotdiet_canonical_format.js --commit     # writes
//
// SAFETY: run inspect_slotdiet_formats.js first to confirm the format
// distribution. Run on staging before prod. Take a DB snapshot before --commit.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const moment = require('moment-timezone');
const db = require('../models');
const { SlotDiet } = db;

const CANONICAL_TZ = 'Asia/Karachi';
const RE_MS_TIMESTAMP = /^\d{10,}$/;
const RE_12H_AMPM = /^\d{1,2}:\d{2}\s*[AaPp][Mm]$/;

function parseArgs(argv) {
  const args = { commit: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--commit') args.commit = true;
  }
  return args;
}

// "1736677740000" → "3:09 PM". The numeric value is interpreted as an
// absolute moment in time; we extract its time-of-day in PKT. The original
// calendar date is intentionally discarded — SlotDiet rows are weekday
// templates, not calendar appointments.
function msToCanonical(s) {
  const ms = parseInt(s.trim(), 10);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return moment.tz(ms, CANONICAL_TZ).format('h:mm A');
}

function classify(raw) {
  if (raw == null) return 'null';
  if (typeof raw !== 'string') return 'non_string';
  const t = raw.trim();
  if (t === '') return 'empty';
  if (RE_12H_AMPM.test(t)) return 'already_canonical';
  if (RE_MS_TIMESTAMP.test(t)) return 'ms_timestamp';
  return 'other';
}

async function main() {
  const args = parseArgs(process.argv);
  const rows = await SlotDiet.findAll({
    attributes: ['id', 'dietitionId', 'TimeDietitionId', 'start', 'end'],
  });

  console.log(`${args.commit ? 'COMMIT' : 'DRY RUN'}: ${rows.length} SlotDiet row(s)`);
  if (!args.commit) console.log('Re-run with --commit to actually write rows.');

  const stats = {
    converted: 0,
    already_canonical: 0,
    skipped_other: 0,
    skipped_null_or_empty: 0,
  };

  for (const row of rows) {
    const startBucket = classify(row.start);
    const endBucket = classify(row.end);

    let newStart = row.start;
    let newEnd = row.end;
    let touched = false;

    if (startBucket === 'ms_timestamp') {
      const c = msToCanonical(row.start);
      if (c) { newStart = c; touched = true; }
    }
    if (endBucket === 'ms_timestamp') {
      const c = msToCanonical(row.end);
      if (c) { newEnd = c; touched = true; }
    }

    if (touched) {
      stats.converted++;
      console.log(
        `  id=${row.id}  ${JSON.stringify(row.start)} → ${JSON.stringify(newStart)}` +
          `  |  ${JSON.stringify(row.end)} → ${JSON.stringify(newEnd)}`
      );
      if (args.commit) {
        await SlotDiet.update(
          { start: newStart, end: newEnd },
          { where: { id: row.id } }
        );
      }
    } else if (startBucket === 'already_canonical' && endBucket === 'already_canonical') {
      stats.already_canonical++;
    } else if (
      ['null', 'empty'].includes(startBucket) ||
      ['null', 'empty'].includes(endBucket)
    ) {
      stats.skipped_null_or_empty++;
      console.log(`  id=${row.id}  SKIPPED null/empty: start=${JSON.stringify(row.start)} end=${JSON.stringify(row.end)}`);
    } else {
      stats.skipped_other++;
      console.log(`  id=${row.id}  SKIPPED unrecognized: start=${JSON.stringify(row.start)} (${startBucket}) end=${JSON.stringify(row.end)} (${endBucket})`);
    }
  }

  console.log(
    `\nDone. converted=${stats.converted} already_canonical=${stats.already_canonical} ` +
      `skipped_null_or_empty=${stats.skipped_null_or_empty} skipped_other=${stats.skipped_other} total=${rows.length}`
  );
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Backfill failed:', err);
      process.exit(1);
    })
    .finally(async () => {
      try { await db.sequelize.close(); } catch (_) {}
    });
}

module.exports = { msToCanonical, classify };
