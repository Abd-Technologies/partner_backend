'use strict';

// Oct 2026: a consultation is put "on hold" while her payment is not
// confirmed (helper/paymentVerify.js). Appointments.paymentHoldAt: when
// it was put on hold; null = not on hold. Idempotent: safe on every start.
module.exports = {
  async up(queryInterface, Sequelize, db) {
    const table = db && db.Appointment ? db.Appointment.getTableName() : 'Appointments';
    const cols = await queryInterface.describeTable(table);
    if (!cols.paymentHoldAt) {
      await queryInterface.addColumn(table, 'paymentHoldAt', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },
};
