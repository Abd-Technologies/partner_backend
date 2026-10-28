'use strict';

// Adds 'DIET_CHECKIN_HELP' to EscalationTickets.trigger (Oct 2026).
// MySQL ENUM: rebuilt as (values already in the DB) + (model values) +
// the new one, so no existing value is ever dropped. Idempotent.
const MODEL_VALUES = [
  'PLAN_DELAYED', 'CONSULT_NO_SHOW', 'CONSULT_UNCONFIRMED', 'CONSULT_CLIENT_NO_SHOW',
  'INACTIVITY', 'MEDICAL', 'REVIEW_FLAG', 'BOOKING_REMINDER_5X', 'SYSTEM_ISSUE',
  'DIET_CHECKIN_HELP',
];

module.exports = {
  async up(queryInterface) {
    const desc = await queryInterface.describeTable('EscalationTickets');
    const col = desc.trigger || desc.Trigger;
    if (!col) return;
    const type = String(col.type || '');
    if (type.includes("'DIET_CHECKIN_HELP'")) return;
    const inDb = (type.match(/'([^']+)'/g) || []).map((v) => v.slice(1, -1));
    const all = [...new Set([...inDb, ...MODEL_VALUES])];
    const list = all.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await queryInterface.sequelize.query(
      `ALTER TABLE \`EscalationTickets\` MODIFY COLUMN \`trigger\` ENUM(${list}) NOT NULL`
    );
  },
  async down() {},
};
