// Reads back scripts/output/plans_to_label.csv (after a human filled in
// the planType column) and writes each value onto Plan.planType.
//
// Dry-run by default — prints what it would change without writing.
// Pass --commit to actually apply. Rows with an empty planType are
// skipped and reported, not defaulted to anything.
//
// Usage:
//   node partner_backend/scripts/apply_plan_type_labels.js            # dry run
//   node partner_backend/scripts/apply_plan_type_labels.js --commit   # writes

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../models');
const { Plan } = db;

const VALID_PLAN_TYPES = new Set(['diet', 'workout', 'combined']);

function parseCsv(text) {
  // Minimal CSV parser matching the writer in list_plans_for_labeling.js
  // (every field quoted, "" as the escape for a literal quote). Good
  // enough for this one-off labeling file — not a general CSV parser.
  const lines = text.trim().split('\n');
  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    const row = {};
    header.forEach((h, idx) => { row[h] = cells[idx]; });
    return row;
  });
}

(async () => {
  const commit = process.argv.includes('--commit');
  try {
    await db.sequelize.authenticate();

    const csvPath = path.join(__dirname, 'output', 'plans_to_label.csv');
    if (!fs.existsSync(csvPath)) {
      console.error(`Not found: ${csvPath}. Run list_plans_for_labeling.js first.`);
      process.exit(1);
    }
    const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));

    let applied = 0, skippedEmpty = 0, skippedInvalid = 0, unchanged = 0;
    for (const row of rows) {
      const id = Number(row.id);
      const planType = (row.planType || '').trim();

      if (!planType) { skippedEmpty++; continue; }
      if (!VALID_PLAN_TYPES.has(planType)) {
        console.warn(`Plan ${id}: invalid planType "${planType}" — must be diet/workout/combined. Skipped.`);
        skippedInvalid++;
        continue;
      }
      if (row.currentPlanType === planType) { unchanged++; continue; }

      console.log(`Plan ${id} ("${row.title}"): ${row.currentPlanType || '(none)'} -> ${planType}`);
      if (commit) {
        await Plan.update({ planType }, { where: { id } });
      }
      applied++;
    }

    console.log('');
    console.log(`${commit ? 'Applied' : 'Would apply'}: ${applied}`);
    console.log(`Unchanged (already correct): ${unchanged}`);
    console.log(`Skipped (blank planType, left unlabeled): ${skippedEmpty}`);
    console.log(`Skipped (invalid value): ${skippedInvalid}`);
    if (!commit) console.log('\nDry run only — re-run with --commit to write these.');

    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
