'use strict';

// Oct 2026: attendance from app taps, for every dietitian.
//   dietitianStartedAt  she pressed "Start session" (portal)
//   clientJoinTapAt     the client tapped "Join Meeting" (app), first tap
//   attendanceSource    'google' | 'taps' (how attendance was decided)
//   attendanceFlag      e.g. 'tap_without_google' (admin should check)
// Idempotent: safe on every start.
module.exports = {
  async up(queryInterface, Sequelize, db) {
    const table = db && db.Appointment ? db.Appointment.getTableName() : 'Appointments';
    const cols = await queryInterface.describeTable(table);
    const add = async (name, spec) => {
      if (!cols[name]) await queryInterface.addColumn(table, name, spec);
    };
    await add('dietitianStartedAt', { type: Sequelize.DATE, allowNull: true });
    await add('clientJoinTapAt', { type: Sequelize.DATE, allowNull: true });
    await add('attendanceSource', { type: Sequelize.STRING(10), allowNull: true });
    await add('attendanceFlag', { type: Sequelize.STRING(40), allowNull: true });
  },
};
