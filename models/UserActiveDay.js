// One row per woman per day she opened the app (Pakistan date).
// Answers: daily / monthly actives, and "slipping away" (used to come
// often, no row for 7 days). Written by helper/growthTracking.js.
module.exports = (sequelize, DataTypes) => {
  const UserActiveDay = sequelize.define(
    "UserActiveDay",
    {
      userId: { type: DataTypes.INTEGER, allowNull: false },
      day: { type: DataTypes.DATEONLY, allowNull: false },
      opens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      platform: { type: DataTypes.STRING(10), allowNull: true },
      appVersion: { type: DataTypes.STRING(20), allowNull: true },
    },
    {
      tableName: "UserActiveDays",
      indexes: [{ unique: true, fields: ["userId", "day"] }, { fields: ["day"] }],
    }
  );
  return UserActiveDay;
};
