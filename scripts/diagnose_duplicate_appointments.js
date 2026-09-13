'use strict';

// One-off, READ-ONLY diagnostic — for each user who currently holds more
// than one ACTIVE (pending/confirmed) Appointment row, prints every one
// of those rows with its id/date/status/createdAt so you can see with
// your own eyes whether they're old rows (created before the
// createAppointment dedup fix landed) or new ones (meaning the fix
// isn't actually running yet — most commonly because the backend
// process needs a restart to pick up the code change; nodemon does this
// automatically, but pm2 does not unless started with --watch).
//
// This does NOT change anything in the database. See
// dedupe_active_appointments.js for the (also-safe-by-default) cleanup
// script, once you've reviewed what this prints.
//
// Usage (from the partner_backend folder, on your own machine — this
// doesn't reach the DB from Claude's sandbox):
//   node scripts/diagnose_duplicate_appointments.js

const { Appointment, User } = require('../models');
const { Op } = require('sequelize');

async function main() {
  const active = await Appointment.findAll({
    where: { status: { [Op.in]: ['pending', 'confirmed'] } },
    include: [
      { model: User, as: 'ClientUser', attributes: ['id', 'firstName', 'lastName', 'email'] },
      // Unaliased — the dietitian side of Appointment.belongsTo(User).
      { model: User, attributes: ['id', 'firstName', 'lastName'] },
    ],
    order: [['userId', 'ASC'], ['createdAt', 'ASC']],
  });

  const byUser = new Map();
  for (const a of active) {
    if (!byUser.has(a.userId)) byUser.set(a.userId, []);
    byUser.get(a.userId).push(a);
  }

  const duplicated = [...byUser.entries()].filter(([, rows]) => rows.length > 1);

  if (duplicated.length === 0) {
    console.log('No user currently holds more than one active (pending/confirmed) appointment. Clean.');
    process.exit(0);
  }

  console.log(`${duplicated.length} user(s) currently hold more than one active appointment:\n`);

  for (const [userId, rows] of duplicated) {
    const client = rows[0].ClientUser;
    const name = client ? `${client.firstName} ${client.lastName}` : `userId ${userId}`;
    console.log(`=== ${name} (userId ${userId}, ${client?.email || 'no email'}) — ${rows.length} active rows ===`);
    for (const r of rows) {
      const dietitian = r.User ? `${r.User.firstName} ${r.User.lastName} (id ${r.dietitionId})` : `dietitianId ${r.dietitionId}`;
      console.log(
        `  id ${r.id} | ${String(r.date).slice(0, 10)} | status: ${r.status} | with ${dietitian} | ` +
        `created: ${r.createdAt ? new Date(r.createdAt).toISOString() : 'unknown'} | ` +
        `reschedule: ${r.reschedule}`
      );
    }
    console.log('');
  }

  console.log(
    'If every row above was created BEFORE you last restarted the backend, ' +
    'this is pre-existing data from before the dedup fix — it will not ' +
    'recur going forward, but it needs a one-time cleanup (see ' +
    'dedupe_active_appointments.js). If any row\'s "created" timestamp is ' +
    'AFTER your last restart, the fix isn\'t actually running yet on this ' +
    'server process — restart it (nodemon picks up file changes ' +
    'automatically; pm2 needs `pm2 restart <name>` explicitly).'
  );

  process.exit(0);
}

main().catch((e) => {
  console.error('diagnose_duplicate_appointments failed:', e);
  process.exit(1);
});
