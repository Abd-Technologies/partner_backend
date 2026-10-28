'use strict';

// Oct 2026: DietitianEmergencyDays table + 'DIETITIAN_EMERGENCY_DAY'
// escalation type (admin alerts list). Idempotent: safe on every start.
const MODEL_VALUES = [
  'PLAN_DELAYED', 'CONSULT_NO_SHOW', 'CONSULT_UNCONFIRMED', 'CONSULT_CLIENT_NO_SHOW',
  'INACTIVITY', 'MEDICAL', 'REVIEW_FLAG', 'BOOKING_REMINDER_5X', 'SYSTEM_ISSUE',
  'DIET_CHECKIN_HELP', 'DIETITIAN_EMERGENCY_DAY',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = (await queryInterface.showAllTables()).map((t) =>
      String(typeof t === 'object' ? t.tableName || Object.values(t)[0] : t).toLowerCase()
    );
    if (!tables.includes('dietitianemergencydays')) {
      await queryInterface.createTable('DietitianEmergencyDays', {
        id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
        dietitianId: { type: Sequelize.INTEGER, allowNull: false },
        day: { type: Sequelize.DATEONLY, allowNull: false },
        reason: { type: Sequelize.STRING(32), allowNull: false },
        note: { type: Sequelize.STRING(255), allowNull: true },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'scheduled' },
        applyAt: { type: Sequelize.DATE, allowNull: true },
        appliedAt: { type: Sequelize.DATE, allowNull: true },
        decidedBy: { type: Sequelize.INTEGER, allowNull: true },
        sessionsCancelled: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        daysGiven: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('DietitianEmergencyDays', ['dietitianId', 'day']);
      await queryInterface.addIndex('DietitianEmergencyDays', ['status']);
    }
    const desc = await queryInterface.describeTable('EscalationTickets');
    const col = desc.trigger || desc.Trigger;
    if (!col) return;
    const type = String(col.type || '');
    if (type.includes("'DIETITIAN_EMERGENCY_DAY'")) return;
    const inDb = (type.match(/'([^']+)'/g) || []).map((v) => v.slice(1, -1));
    const all = [...new Set([...inDb, ...MODEL_VALUES])];
    const list = all.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
    await queryInterface.sequelize.query(
      `ALTER TABLE \`EscalationTickets\` MODIFY COLUMN \`trigger\` ENUM(${list}) NOT NULL`
    );
  },
  async down() {},
};
