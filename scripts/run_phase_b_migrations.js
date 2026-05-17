// One-shot runner for the Phase B migrations.
//
// Why this exists: the project's `npx sequelize-cli db:migrate` queue is
// blocked on `20260505000001-create-consultation-flow-tables` because
// db.sequelize.sync() (app.js:283) already created those tables in the
// dev DB, and the original migration is not idempotent. Touching that
// migration is out of scope for Phase B, so this script applies just
// the Phase B migrations directly. They are written idempotently
// (describeTable / showAllTables guards), so re-running is a no-op.
//
// On a clean DB you should still use `npx sequelize-cli db:migrate` —
// this script is a dev-DB unblocker, not the canonical entry point.
//
// Run: node scripts/run_phase_b_migrations.js

require('dotenv').config();
const path = require('path');
const db = require('../models');

const MIGRATIONS = [
  '20260507130000-add-timezone-to-users.js',
  '20260507130100-add-meals-per-day-to-preconsultation-profile.js',
  '20260507130200-create-diet-plans.js',
  '20260507130300-create-diet-plan-days.js',
  '20260507130400-create-diet-plan-meals.js',
];

async function main() {
  const qi = db.sequelize.getQueryInterface();
  const Sequelize = db.Sequelize;

  for (const file of MIGRATIONS) {
    const fullPath = path.join(__dirname, '..', 'migrations', file);
    const migration = require(fullPath);
    process.stdout.write(`-> ${file} ... `);
    await migration.up(qi, Sequelize);
    console.log('OK');
  }

  await db.sequelize.close();
  console.log('\nAll Phase B migrations applied.');
}

main().catch((err) => {
  console.error('\nFAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
