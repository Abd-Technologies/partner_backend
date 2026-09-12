// Pulls every catalog Plan so a human can confirm its real type before
// the four inconsistent detectors (Category.title lookups with
// mismatched casing, title substring matching, unverified client input)
// get replaced with the new Plan.planType column.
//
// Deliberately does NOT auto-fill planType from the existing heuristics
// — that would just bake today's guesses (which are already proven
// wrong at least once, the "Workout"/"WorkOut" casing mismatch) into
// the new "authoritative" field. The `suggested` column below is a
// hint only, not a value that gets written anywhere.
//
// Usage:
//   node partner_backend/scripts/list_plans_for_labeling.js
// Writes scripts/output/plans_to_label.csv — open it, fill in the
// `planType` column for each row (diet / workout / combined), save,
// then run apply_plan_type_labels.js --commit.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../models');
const { Plan, Category } = db;

function suggest(title, categoryTitle) {
  const t = (title || '').toLowerCase();
  const c = (categoryTitle || '').toLowerCase();
  const hasDiet = t.includes('diet') || c.includes('diet');
  const hasWorkout = t.includes('workout') || c.includes('workout') || c.includes('work out');
  if (hasDiet && hasWorkout) return 'combined';
  if (hasDiet) return 'diet';
  if (hasWorkout) return 'workout';
  return '';
}

(async () => {
  try {
    await db.sequelize.authenticate();
    const plans = await Plan.findAll({
      include: [{ model: Category, attributes: ['id', 'title'] }],
      order: [['id', 'ASC']],
    });

    const rows = plans.map((p) => {
      const categoryTitle = p.Category ? p.Category.title : '';
      return {
        id: p.id,
        title: p.title || '',
        categoryTitle,
        status: p.status,
        currentPlanType: p.planType || '',
        suggested: suggest(p.title, categoryTitle),
        planType: '', // <- fill this in: diet / workout / combined
      };
    });

    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'plans_to_label.csv');

    const header = 'id,title,categoryTitle,status,currentPlanType,suggested,planType';
    const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [header, ...rows.map((r) =>
      [r.id, r.title, r.categoryTitle, r.status, r.currentPlanType, r.suggested, r.planType]
        .map(csvEscape).join(',')
    )];
    fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');

    console.log(`Wrote ${rows.length} plan(s) to ${outPath}`);
    console.log('Fill in the planType column (diet / workout / combined) for each row, then run:');
    console.log('  node scripts/apply_plan_type_labels.js --commit');

    process.exit(0);
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();
