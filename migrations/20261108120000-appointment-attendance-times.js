'use strict';

// Nov 2026: close-to-real join / leave times from the app (no Google).
//   clientLastJoinTapAt      her latest "Join" tap (clientJoinTapAt = first)
//   clientJoinTapCount       how many times she tapped Join (rejoins)
//   clientReturnedAt         she came back to Fit Her after the call (= left)
//   dietitianEndedAt         the dietitian ended it, or the slot end (auto)
//   dietitianEndSource       'tap' | 'auto'
//   dietitianReportedMinutes the dietitian's answer "about how long?"
// Idempotent: safe on every start.
module.exports = {
  async up(queryInterface, Sequelize, db) {
    const table = db && db.Appointment ? db.Appointment.getTableName() : 'Appointments';
    const cols = await queryInterface.describeTable(table);
    const add = async (name, spec) => {
      if (!cols[name]) await queryInterface.addColumn(table, name, spec);
    };
    await add('clientLastJoinTapAt', { type: Sequelize.DATE, allowNull: true });
    await add('clientJoinTapCount', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await add('clientReturnedAt', { type: Sequelize.DATE, allowNull: true });
    await add('dietitianEndedAt', { type: Sequelize.DATE, allowNull: true });
    await add('dietitianEndSource', { type: Sequelize.STRING(10), allowNull: true });
    await add('dietitianReportedMinutes', { type: Sequelize.INTEGER, allowNull: true });
  },
};
