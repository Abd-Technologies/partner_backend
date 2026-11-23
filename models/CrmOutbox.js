// CRM outbox (Nov 2026): every event the CRM must know about (signup,
// purchase, payment rejected, plan expired / frozen / unfrozen, support
// ticket) is saved here first, then sent by helper/crmEvents.js. If the
// CRM is down the row stays "pending" and the minute cron retries it, so
// no event is lost. externalEventId is unique: the same thing can't be
// queued twice, and the CRM uses it to ignore repeats.
module.exports = (sequelize, DataTypes) => {
  const CrmOutbox = sequelize.define(
    "CrmOutbox",
    {
      eventType: { type: DataTypes.STRING(40), allowNull: false },
      externalEventId: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      appUserId: { type: DataTypes.INTEGER, allowNull: true },
      payload: { type: DataTypes.TEXT("medium"), allowNull: false }, // JSON
      // pending → sent | dead (CRM said the event is bad, or gave up)
      status: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "pending" },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: DataTypes.DATE, allowNull: false },
      lastError: { type: DataTypes.STRING(500), allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
    },
    // Indexes are added by migrations/20261111120000-crm-outbox.js (run on
    // start), not here: sync() adding them could crash the server start.
    { tableName: "CrmOutbox" }
  );
  return CrmOutbox;
};
