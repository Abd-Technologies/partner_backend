// CRM outbox (Nov 2026): every event the CRM must know about (signup,
// payment, trial, plan expired / frozen…) is saved here first, then
// helper/crmOutboxSender.js delivers it and retries until the CRM confirms.
// So a CRM outage never loses a payment. Written by helper/crmEvents.js.
//
// status: pending → sending → sent   (or → dead after 24 h of failures)
module.exports = (sequelize, DataTypes) => {
  const CrmOutbox = sequelize.define(
    "CrmOutbox",
    {
      eventId:       { type: DataTypes.STRING(120), allowNull: false, unique: true }, // idempotency key the CRM dedupes on
      eventType:     { type: DataTypes.STRING(60), allowNull: false },
      userId:        { type: DataTypes.INTEGER, allowNull: true },
      payload:       { type: DataTypes.JSON, allowNull: false },
      occurredAt:    { type: DataTypes.DATE(3), allowNull: false },
      status:        { type: DataTypes.STRING(12), allowNull: false, defaultValue: "pending" },
      attempts:      { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      lockId:        { type: DataTypes.STRING(40), allowNull: true },
      lockedAt:      { type: DataTypes.DATE, allowNull: true },
      lastError:     { type: DataTypes.TEXT, allowNull: true },
      sentAt:        { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "CrmOutbox",
      indexes: [
        { fields: ["status", "nextAttemptAt"] },
        { fields: ["lockId"] },
        { fields: ["userId"] },
      ],
    }
  );
  return CrmOutbox;
};
