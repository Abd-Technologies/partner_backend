// Fit Her's own accounts that clients pay into (admin adds / edits them).
// Shown on the "Upload payment slip" screen and used to check slips:
// a slip is only approved automatically when it shows one of these.
//   kind      wallet (JazzCash / EasyPaisa number) | bank
//   provider  "JazzCash", "EasyPaisa", "JazzCash / EasyPaisa", "Soneri Bank"…
//   title     account title as it appears on slips
//   number    wallet mobile number or bank account number
module.exports = (sequelize, DataTypes) => {
  const PaymentAccount = sequelize.define(
    "PaymentAccount",
    {
      kind: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "wallet" },
      provider: { type: DataTypes.STRING(60), allowNull: false },
      title: { type: DataTypes.STRING(120), allowNull: false },
      number: { type: DataTypes.STRING(40), allowNull: false },
      iban: { type: DataTypes.STRING(40), allowNull: true },
      branch: { type: DataTypes.STRING(200), allowNull: true },
      swift: { type: DataTypes.STRING(20), allowNull: true },
      note: { type: DataTypes.STRING(255), allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      updatedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "PaymentAccounts" }
  );
  return PaymentAccount;
};
