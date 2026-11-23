'use strict';

// Nov 2026: CRM outbox table (models/CrmOutbox.js, helper/crmEvents.js).
// Idempotent, run on every start from app.js: creates the table if it's
// missing, adds any missing column (repairs a half-made table), then the
// two indexes. Never throws from app.js (wrapped in try/catch there).
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'CrmOutbox';
    const cols = {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      eventType: { type: Sequelize.STRING(40), allowNull: false },
      externalEventId: { type: Sequelize.STRING(120), allowNull: false, unique: true },
      appUserId: { type: Sequelize.INTEGER, allowNull: true },
      payload: { type: Sequelize.TEXT('medium'), allowNull: false },
      status: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'pending' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: Sequelize.DATE, allowNull: false },
      lastError: { type: Sequelize.STRING(500), allowNull: true },
      sentAt: { type: Sequelize.DATE, allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    };

    let existing = null;
    try { existing = await queryInterface.describeTable(table); } catch (_) { existing = null; }
    // An older, unused CrmOutbox layout (required unique `eventId`) may exist
    // from an earlier experiment: keep its rows under another name (nothing
    // is deleted) and start a clean table.
    if (existing && existing.eventId && !existing.eventId.allowNull) {
      let legacy = `${table}_legacy`;
      try { await queryInterface.describeTable(legacy); legacy = `${table}_legacy_${Date.now()}`; } catch (_) { /* name free */ }
      await queryInterface.renameTable(table, legacy);
      console.log(`[crm-outbox] old CrmOutbox layout kept as ${legacy}; creating a new table`);
      existing = null;
    }
    if (!existing) {
      await queryInterface.createTable(table, cols);
    } else {
      for (const [name, def] of Object.entries(cols)) {
        if (existing[name] || name === 'id') continue;
        const { primaryKey, autoIncrement, unique, ...plain } = def;
        // Existing rows need a value for NOT NULL columns.
        if (plain.allowNull === false && plain.defaultValue === undefined) plain.allowNull = true;
        await queryInterface.addColumn(table, name, plain);
      }
    }

    const have = new Set(((await queryInterface.showIndex(table)) || []).map((i) => i.name));
    if (!have.has('crm_outbox_status_next_attempt_at')) {
      await queryInterface.addIndex(table, ['status', 'nextAttemptAt'], { name: 'crm_outbox_status_next_attempt_at' });
    }
    if (!have.has('crm_outbox_app_user_id')) {
      await queryInterface.addIndex(table, ['appUserId'], { name: 'crm_outbox_app_user_id' });
    }
  },
};
