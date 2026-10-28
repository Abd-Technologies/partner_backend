// Purchase history: one row per APPROVED payment, never changed or
// deleted (UserPlan rows are extended in place / deleted when expired,
// so they can't answer renewal rate, upgrades or lifetime value).
// Written by helper/purchaseLedger.js.
module.exports = (sequelize, DataTypes) => {
  const PlanPurchase = sequelize.define(
    "PlanPurchase",
    {
      userId: { type: DataTypes.INTEGER, allowNull: false },
      planId: { type: DataTypes.INTEGER, allowNull: true },
      planTitle: { type: DataTypes.STRING(150), allowNull: true },
      planType: { type: DataTypes.STRING(20), allowNull: true }, // diet / workout / combined
      userPlanId: { type: DataTypes.INTEGER, allowNull: true },
      // new / renewal / upgrade / switch
      kind: { type: DataTypes.STRING(12), allowNull: false, defaultValue: "new" },
      previousPlanType: { type: DataTypes.STRING(20), allowNull: true },
      amount: { type: DataTypes.INTEGER, allowNull: true }, // PKR paid
      listPrice: { type: DataTypes.INTEGER, allowNull: true },
      discountAmount: { type: DataTypes.INTEGER, allowNull: true },
      days: { type: DataTypes.INTEGER, allowNull: true },
      method: { type: DataTypes.STRING(20), allowNull: true }, // slip / magic_link / rep_crm / directpay
      approvedBy: { type: DataTypes.STRING(10), allowNull: true }, // auto / admin
      approvedById: { type: DataTypes.INTEGER, allowNull: true },
      planImageId: { type: DataTypes.INTEGER, allowNull: true },
      salesRepId: { type: DataTypes.INTEGER, allowNull: true },
      purchasedAt: { type: DataTypes.DATE, allowNull: false },
    },
    { tableName: "PlanPurchases", indexes: [{ fields: ["userId", "purchasedAt"] }, { fields: ["purchasedAt"] }] }
  );
  return PlanPurchase;
};
