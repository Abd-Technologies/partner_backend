'use strict';

// Adds "CONSULT_UNCONFIRMED" to EscalationTickets.trigger's ENUM so a
// booking that expired because the dietitian never confirmed it in
// time can be logged as its own kind of escalation, separate from
// "CONSULT_NO_SHOW" (which means she confirmed but never joined).
//
// changeColumn re-applying the same ENUM list is a harmless no-op, so
// this is safe to run more than once.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('EscalationTickets', 'trigger', {
      type: Sequelize.ENUM(
        'PLAN_DELAYED',
        'CONSULT_NO_SHOW',
        'CONSULT_UNCONFIRMED',
        'INACTIVITY',
        'MEDICAL',
        'REVIEW_FLAG',
        'BOOKING_REMINDER_5X',
        'SYSTEM_ISSUE'
      ),
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('EscalationTickets', 'trigger', {
      type: Sequelize.ENUM(
        'PLAN_DELAYED',
        'CONSULT_NO_SHOW',
        'INACTIVITY',
        'MEDICAL',
        'REVIEW_FLAG',
        'BOOKING_REMINDER_5X',
        'SYSTEM_ISSUE'
      ),
      allowNull: false,
    });
  },
};
