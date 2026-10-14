'use strict';
/**
 * App update rule, one row per platform ("android" / "ios").
 *   latestVersion  — newer than hers → soft popup ("Update / Later").
 *   minimumVersion — older than this → must update (no "Later").
 *   storeUrl       — where "Update" goes (Play Store / App Store page).
 * Set from the admin app (App Version screen). New table: created by
 * sequelize.sync() on server start. See controllers/appVersionController.js.
 */
module.exports = (sequelize, DataTypes) => {
  return sequelize.define('AppVersionConfig', {
    platform: { type: DataTypes.STRING(16), allowNull: false, unique: true },
    latestVersion: { type: DataTypes.STRING(20), allowNull: true },
    minimumVersion: { type: DataTypes.STRING(20), allowNull: true },
    storeUrl: { type: DataTypes.STRING(300), allowNull: true },
    message: { type: DataTypes.STRING(300), allowNull: true },
    // Last version an "update" push was sent for (once per version).
    notifiedVersion: { type: DataTypes.STRING(20), allowNull: true },
    notifiedAt: { type: DataTypes.DATE, allowNull: true },
  });
};
