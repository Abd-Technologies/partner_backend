// One-shot runner for the Phase F.2 migration. Mirrors Phase B's
// scripts/run_phase_b_migrations.js — the project-wide
// `npx sequelize-cli db:migrate` queue is still blocked on the
// non-idempotent `20260505000001-create-consultation-flow-tables`
// migration. The Phase F.2 migration is idempotent (re-running is a
// no-op), so direct application is safe.
//
// Run: node scripts/run_phase_f2_migration.js

require('dotenv').config();
const path = require('path');
const db = require('../models');

const MIGRATIONS = [
  '20260508120000-extend-meal-log-meal-types.js',
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
  console.log('\nPhase F.2 migration applied.');
}

main().catch((err) => {
  console.error('\nFAILED:', err && err.message ? err.message : err);
  process.exit(1);
});
