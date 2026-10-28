// Every payment attempt: slip uploaded (pending → approved / rejected) and
// DirectPay links opened (initiated). Rejected slips used to be deleted,
// so the failed-payment rate was lost. Written by helper/purchaseLedger.js.
module.exports = (sequelize, DataTypes) => {
  const PaymentAttempt = sequelize.define(
    "PaymentAttempt",
    {
      userId: { type: DataTypes.INTEGER, allowNull: true },
      planId: { type: DataTypes.INTEGER, allowNull: true },
      durationId: { type: DataTypes.INTEGER, allowNull: true },
      amount: { type: DataTypes.INTEGER, allowNull: true },
      method: { type: DataTypes.STRING(20), allowNull: true }, // slip / magic_link / rep_crm / directpay
      // pending / approved / rejected / initiated
      status: { type: DataTypes.STRING(12), allowNull: false, defaultValue: "pending" },
      planImageId: { type: DataTypes.INTEGER, allowNull: true },
      ref: { type: DataTypes.STRING(80), allowNull: true }, // DirectPay transaction id
      autoChecked: { type: DataTypes.BOOLEAN, allowNull: true },
      decidedAt: { type: DataTypes.DATE, allowNull: true },
      decidedById: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "PaymentAttempts", indexes: [{ fields: ["userId"] }, { fields: ["planImageId"] }, { fields: ["createdAt"] }] }
  );
  return PaymentAttempt;
};
