'use strict';

// One-off, READ-ONLY diagnostic for the exact bug reported: two DIFFERENT
// clients holding an active appointment with the SAME dietitian on the
// SAME date whose displayed time overlaps or matches (e.g. both showing
// "12:30 PM - 1:30 PM" in the dietitian's home panel).
//
// This checks TWO separate things that look identical on screen but are
// different bugs underneath:
//
//   A) Same dietitianId + same date + same timeSlotId, two different
//      users. This is exactly what appointmentController.createAppointment
//      is supposed to prevent (the "Time slot already booked" check). If
//      you see this AFTER restarting the backend with today's transaction
//      fix, the fix itself has a real problem — report the createdAt
//      timestamps here back so we can tell whether these rows predate the
//      restart (old data, needs cleanup only) or postdate it (fix still
//      broken).
//
//   B) Same dietitianId + same date + same DISPLAYED start/end time, but
//      DIFFERENT timeSlotId. This means there are two separate SlotDiet
//      rows in the calendar that represent the same clock time — a data
//      problem in the slot templates themselves, not a race condition or
//      a missing check. createAppointment's collision check is keyed on
//      timeSlotId, so it can never catch this case no matter how it's
//      written; the two bookings are, as far as that check is concerned,
//      for two genuinely different slots that just happen to render
//      identically.
//
// Usage (from the partner_backend folder, on your own machine):
//   node scripts/diagnose_same_slot_collision.js

const { Appointment, User, SlotDiet } = require('../models');
const { Op } = require('sequelize');

function clientName(a) {
  return a.ClientUser ? `${a.ClientUser.firstName} ${a.ClientUser.lastName}` : `userId ${a.userId}`;
}

function fmtDate(d) {
  return d ? new Date(d).toISOString() : 'unknown';
}

async function main() {
  const active = await Appointment.findAll({
    where: { status: { [Op.in]: ['pending', 'confirmed', 'In Progress', 'completed'] } },
    include: [
      { model: User, as: 'ClientUser', attributes: ['id', 'firstName', 'lastName', 'email'] },
      { model: SlotDiet, attributes: ['id', 'start', 'end'] },
    ],
    order: [['dietitionId', 'ASC'], ['date', 'ASC'], ['createdAt', 'ASC']],
  });

  // Group by dietitianId + calendar date.
  const byDietitianDate = new Map();
  for (const a of active) {
    const dateKey = String(a.date).slice(0, 10);
    const key = `${a.dietitionId}|${dateKey}`;
    if (!byDietitianDate.has(key)) byDietitianDate.set(key, []);
    byDietitianDate.get(key).push(a);
  }

  let sameSlotCollisions = 0;
  let displayOnlyCollisions = 0;

  for (const [key, rows] of byDietitianDate.entries()) {
    if (rows.length <= 1) continue;
    // Only care about groups spanning more than one client.
    const distinctUsers = new Set(rows.map((r) => r.userId));
    if (distinctUsers.size <= 1) continue;

    const [dietitianId, dateKey] = key.split('|');

    // A) exact same timeSlotId, different users.
    const byTimeSlot = new Map();
    for (const r of rows) {
      if (!byTimeSlot.has(r.timeSlotId)) byTimeSlot.set(r.timeSlotId, []);
      byTimeSlot.get(r.timeSlotId).push(r);
    }
    for (const [timeSlotId, slotRows] of byTimeSlot.entries()) {
      const users = new Set(slotRows.map((r) => r.userId));
      if (users.size > 1) {
        sameSlotCollisions++;
        console.log(`=== [SAME timeSlotId ${timeSlotId}] dietitianId ${dietitianId}, date ${dateKey} ===`);
        for (const r of slotRows) {
          console.log(
            `  appointment id ${r.id} | ${clientName(r)} | status: ${r.status} | ` +
            `createdAt: ${fmtDate(r.createdAt)} | slot: ${r.SlotDiet?.start}-${r.SlotDiet?.end}`
          );
        }
        console.log('');
      }
    }

    // B) different timeSlotId, but identical displayed start/end.
    const byDisplay = new Map();
    for (const r of rows) {
      const display = `${r.SlotDiet?.start}-${r.SlotDiet?.end}`;
      if (!byDisplay.has(display)) byDisplay.set(display, []);
      byDisplay.get(display).push(r);
    }
    for (const [display, dispRows] of byDisplay.entries()) {
      const distinctSlotIds = new Set(dispRows.map((r) => r.timeSlotId));
      const users = new Set(dispRows.map((r) => r.userId));
      if (distinctSlotIds.size > 1 && users.size > 1) {
        displayOnlyCollisions++;
        console.log(`=== [SAME displayed time "${display}", DIFFERENT timeSlotId] dietitianId ${dietitianId}, date ${dateKey} ===`);
        for (const r of dispRows) {
          console.log(
            `  appointment id ${r.id} | ${clientName(r)} | status: ${r.status} | timeSlotId: ${r.timeSlotId} | ` +
            `createdAt: ${fmtDate(r.createdAt)}`
          );
        }
        console.log('');
      }
    }
  }

  console.log('---');
  console.log(`${sameSlotCollisions} true same-timeSlotId collision group(s) found (case A).`);
  console.log(`${displayOnlyCollisions} same-displayed-time-but-different-slot-row group(s) found (case B).`);
  if (sameSlotCollisions === 0 && displayOnlyCollisions === 0) {
    console.log('No cross-client collisions on any active appointment. Clean.');
  } else {
    console.log(
      'For any case-A group: check whether every createdAt is BEFORE your last ' +
      'backend restart (old data, safe to clean up with dedupe_active_appointments.js ' +
      'after review) or if any is AFTER it (the transaction fix has a real bug — send ' +
      'this output back). For case-B groups, the fix is in the slot templates ' +
      '(SlotDiet rows), not in createAppointment.'
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('diagnose_same_slot_collision failed:', e);
  process.exit(1);
});
