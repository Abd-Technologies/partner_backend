'use strict';

// One-off cleanup for the two ways an Appointment can be sitting in
// 'pending'/'confirmed' ("active") when it shouldn't be:
//
//   A) The appointment's date has already passed. Nothing in this app
//      auto-transitions a stale pending/confirmed row once its date is
//      behind us — there's no "session ended" cron for consultations
//      (unlike Slot.completed_by's cron for workout slots). A confirmed
//      PAST appointment is assumed to have happened -> 'completed'. A
//      pending PAST appointment was never actioned -> 'canceled'.
//
//   B) Multiple active (pending/confirmed) rows for the SAME user still
//      remain after rule A — i.e. genuine duplicates on FUTURE dates,
//      predating the createAppointment dedup fix. Exactly one survives:
//      prefer a 'confirmed' row (most recently created, if more than
//      one) over 'pending' ones; if none are confirmed, keep the most
//      recently created 'pending' one. Everything else in the group is
//      canceled.
//
// Neither rule sends push notifications — this is a backfill for stale
// data (some of it well over a year old), not a live user action.
//
// DRY RUN BY DEFAULT — prints exactly what it would change without
// writing anything. Re-run with --apply to actually write the changes.
//
// Usage (from the partner_backend folder, on your own machine — this
// doesn't reach the DB from Claude's sandbox):
//   node scripts/dedupe_active_appointments.js            # dry run
//   node scripts/dedupe_active_appointments.js --apply    # writes changes

const { Appointment, User } = require('../models');
const { Op } = require('sequelize');

const APPLY = process.argv.includes('--apply');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function clientName(a) {
  return a.ClientUser ? `${a.ClientUser.firstName} ${a.ClientUser.lastName}` : `userId ${a.userId}`;
}

async function main() {
  const today = startOfToday();
  const active = await Appointment.findAll({
    where: { status: { [Op.in]: ['pending', 'confirmed'] } },
    include: [{ model: User, as: 'ClientUser', attributes: ['id', 'firstName', 'lastName', 'email'] }],
    order: [['userId', 'ASC'], ['createdAt', 'ASC']],
  });

  let staleResolved = 0;
  let dupesResolved = 0;

  // --- Rule A: past-dated active rows --------------------------------
  const stillActive = [];
  for (const a of active) {
    const apptDate = new Date(a.date);
    if (apptDate < today) {
      const newStatus = a.status === 'confirmed' ? 'completed' : 'canceled';
      console.log(
        `[STALE] id ${a.id} (${clientName(a)}) ${a.status} -> ${newStatus} ` +
        `(date ${apptDate.toDateString()} already passed)`
      );
      if (APPLY) {
        a.status = newStatus;
        a.message = a.message || `Auto-resolved: date passed without action (dedupe script, ${new Date().toISOString().slice(0, 10)})`;
        a.status_changed_at = new Date();
        await a.save();
      }
      staleResolved++;
    } else {
      stillActive.push(a);
    }
  }

  // --- Rule B: same-user duplicates on future dates -------------------
  const byUser = new Map();
  for (const a of stillActive) {
    if (!byUser.has(a.userId)) byUser.set(a.userId, []);
    byUser.get(a.userId).push(a);
  }

  for (const [, rows] of byUser.entries()) {
    if (rows.length <= 1) continue;
    const confirmed = rows.filter((r) => r.status === 'confirmed');
    const pool = confirmed.length > 0 ? confirmed : rows;
    // Most recently created within the winning pool.
    const winner = pool.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b));
    const name = clientName(winner);

    for (const r of rows) {
      if (r.id === winner.id) continue;
      console.log(`[DUPLICATE] ${name}: canceling id ${r.id} (${r.status}), keeping id ${winner.id} (${winner.status})`);
      if (APPLY) {
        r.status = 'canceled';
        r.message = r.message || `Auto-resolved: duplicate of appointment ${winner.id} (dedupe script, ${new Date().toISOString().slice(0, 10)})`;
        r.status_changed_at = new Date();
        await r.save();
      }
      dupesResolved++;
    }
  }

  console.log('');
  console.log(`${staleResolved} stale past-dated row(s) ${APPLY ? 'resolved' : 'would be resolved'}.`);
  console.log(`${dupesResolved} duplicate row(s) ${APPLY ? 'canceled' : 'would be canceled'}.`);
  if (!APPLY) {
    console.log('This was a DRY RUN — nothing was changed. Re-run with --apply to write these changes.');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('dedupe_active_appointments failed:', e);
  process.exit(1);
});
