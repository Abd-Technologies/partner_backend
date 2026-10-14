// Database check: compares every model with the real tables and lists
// any column the code expects but the database doesn't have yet.
//
// Why: `npx sequelize-cli db:migrate` is blocked on this project (old
// migrations aren't safe to re-run on a DB that sequelize.sync() built),
// and sync() creates NEW tables but never adds columns to EXISTING ones.
// A missing column = that feature's queries fail.
//
//   node scripts/checkDbColumns.js          → only REPORTS, changes nothing
//   node scripts/checkDbColumns.js --apply  → adds the missing columns
//
// Adding is safe: columns are added as nullable (or with their default),
// nothing is deleted or renamed, existing data is untouched. Missing
// TABLES are only reported — the server creates them itself on start
// (sequelize.sync()). Safe to run any number of times.
require("dotenv").config();
const db = require("../models");

const APPLY = process.argv.includes("--apply");

async function main() {
  const qi = db.sequelize.getQueryInterface();
  const tables = new Set((await qi.showAllTables()).map((t) => String(t.tableName || t).toLowerCase()));
  let missingCols = 0;
  let added = 0;

  for (const model of Object.values(db.sequelize.models)) {
    const table = model.getTableName();
    const tableName = String(table.tableName || table);
    if (!tables.has(tableName.toLowerCase())) {
      console.log(`• table ${tableName}: not created yet (the server creates it on start)`);
      continue;
    }
    const desc = await qi.describeTable(tableName);
    const have = new Set(Object.keys(desc).map((k) => k.toLowerCase()));
    for (const [name, attr] of Object.entries(model.rawAttributes)) {
      if (attr.type && attr.type.key === "VIRTUAL") continue;
      const field = attr.field || name;
      if (have.has(field.toLowerCase())) continue;
      missingCols++;
      if (!APPLY) {
        console.log(`✗ ${tableName}.${field} is missing`);
        continue;
      }
      const def = { type: attr.type, allowNull: true };
      if (attr.defaultValue !== undefined && typeof attr.defaultValue !== "function" && !(attr.defaultValue && attr.defaultValue.fn)) {
        def.defaultValue = attr.defaultValue;
      }
      try {
        await qi.addColumn(tableName, field, def);
        added++;
        console.log(`✓ added ${tableName}.${field}`);
      } catch (e) {
        console.log(`! could not add ${tableName}.${field}: ${e.message}`);
      }
    }
  }

  if (!missingCols) console.log("\nAll good: every column the code needs is in the database.");
  else if (!APPLY) console.log(`\n${missingCols} missing column(s). Run again with --apply to add them.`);
  else console.log(`\nDone: added ${added} of ${missingCols} missing column(s).`);
  await db.sequelize.close();
}

main().catch(async (e) => {
  console.error("Check failed:", e.message);
  try { await db.sequelize.close(); } catch (_) {}
  process.exit(1);
});
