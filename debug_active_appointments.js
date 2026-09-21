// One-off diagnostic. Run this yourself in your own terminal with:
//   node debug_active_appointments.js
// (Not runnable from the cloud/device shell — it needs the real DB
// connection your own terminal has.) Delete it once we're done.
const db = require('./models');
const { Op } = require('sequelize');

(async () => {
  try {
    console.log('=== All active (pending/confirmed/In Progress) appointments, grouped by client ===');
    const active = await db.Appointment.findAll({
      where: { status: { [Op.in]: ['pending', 'confirmed', 'In Progress'] } },
      order: [['userId', 'ASC'], ['date', 'ASC']],
      raw: true,
    });
    console.log('COUNT:', active.length);
    active.forEach((a) => {
      console.log(
        `id=${a.id} userId=${a.userId} dietitionId=${a.dietitionId} status=${a.status} date=${a.date} timeSlotId=${a.timeSlotId} hasMeetLink=${!!a.meetLink} statusChangedAt=${a.status_changed_at} updatedAt=${a.updatedAt}`
      );
    });

    console.log('\n=== Most recently updated appointments (last 10) — should show the one you just started ===');
    const recent = await db.Appointment.findAll({
      order: [['updatedAt', 'DESC']],
      limit: 10,
      raw: true,
    });
    recent.forEach((a) => {
      console.log(
        `id=${a.id} userId=${a.userId} status=${a.status} date=${a.date} statusChangedAt=${a.status_changed_at} updatedAt=${a.updatedAt}`
      );
    });

    console.log('\n=== Any client (userId) with MORE THAN ONE active appointment ===');
    const byUser = {};
    active.forEach((a) => {
      byUser[a.userId] = byUser[a.userId] || [];
      byUser[a.userId].push(a.id);
    });
    Object.entries(byUser).forEach(([uid, ids]) => {
      if (ids.length > 1) console.log(`userId=${uid} has ${ids.length} active appointments: ${ids.join(', ')}`);
    });
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    await db.sequelize.close();
  }
})();
