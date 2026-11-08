// Which CRM lead a rep's trial link was made for (Nov 2026). Own table so
// TrialTokens is untouched. Read by the trial start to link her to the lead.
module.exports = (sequelize, DataTypes) => {
  const TrialTokenCrmLead = sequelize.define(
    "TrialTokenCrmLead",
    {
      trialTokenId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      crmLeadId:    { type: DataTypes.INTEGER, allowNull: false },
    },
    { tableName: "TrialTokenCrmLeads" }
  );
  return TrialTokenCrmLead;
};
