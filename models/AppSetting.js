// Simple key → value settings the admin changes from the app.
//   mainZoomRoom: the Fit Her class room every trainer uses unless she
//                 has her own room (see helper/classRoomSettings.js).
module.exports = (sequelize, DataTypes) => {
  const AppSetting = sequelize.define(
    "AppSetting",
    {
      key: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      value: { type: DataTypes.TEXT, allowNull: true },
      updatedBy: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: "AppSettings" }
  );
  return AppSetting;
};
