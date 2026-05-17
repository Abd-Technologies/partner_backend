// Loads the diet-plan models + AIGenerationLog and dumps their
// attribute definitions. No queries, no inserts — purely verifies that
// model files load, associations resolve, and field/index definitions
// look right.
//
// Run: node scripts/verify_diet_plan_schema.js

require('dotenv').config();

const db = require('../models');

const REQUIRED = ['DietPlan', 'DietPlanDay', 'DietPlanMeal', 'AIGenerationLog'];

function describe(model) {
  const out = {};
  for (const [name, attr] of Object.entries(model.rawAttributes)) {
    const t = attr.type && attr.type.constructor && attr.type.constructor.name;
    out[name] = {
      type: t || String(attr.type),
      allowNull: attr.allowNull,
      primaryKey: !!attr.primaryKey,
      autoIncrement: !!attr.autoIncrement,
      defaultValue: attr.defaultValue,
      references: attr.references || undefined,
    };
  }
  return out;
}

async function main() {
  const missing = REQUIRED.filter((name) => !db[name]);
  if (missing.length) {
    console.error('Missing models:', missing.join(', '));
    process.exit(1);
  }

  for (const name of REQUIRED) {
    const model = db[name];
    console.log(`\n── ${name} (table: ${model.getTableName()}) ──`);
    console.log(JSON.stringify(describe(model), null, 2));
    const associations = Object.keys(model.associations);
    if (associations.length) {
      console.log('Associations:', associations.join(', '));
    }
  }

  console.log('\nSchema OK');
  // Close the pool so the process exits cleanly. close() can throw on a
  // never-connected sequelize, hence the catch.
  try {
    await db.sequelize.close();
  } catch (_) {}
  process.exit(0);
}

main().catch((err) => {
  console.error('Verification failed:', err && err.message ? err.message : err);
  process.exit(1);
});
