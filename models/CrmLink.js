// CRM link (Nov 2026): which CRM lead this app user is. One row per user,
// never overwritten. Written by helper/crmLink.js when she pays through a
// rep's magic link or starts a trial from a rep's trial link. Kept in its
// own table (not a Users column) so no existing query depends on it.
module.exports = (sequelize, DataTypes) => {
  const CrmLink = sequelize.define(
    "CrmLink",
    {
      userId:    { type: DataTypes.INTEGER, allowNull: false, unique: true },
      crmLeadId: { type: DataTypes.INTEGER, allowNull: false },
      source:    { type: DataTypes.STRING(20), allowNull: false }, // magic_link | trial_link | backfill
    },
    { tableName: "CrmLinks", indexes: [{ fields: ["crmLeadId"] }] }
  );
  return CrmLink;
};
