'use strict';
/**
 * End-of-trial offer, one per user. Created the first time her "My trial"
 * summary is opened on her last trial day (or after the trial ended).
 * Prices are frozen here in HER country's currency so the countdown and
 * amounts are the same on every device and can't be reset by
 * reinstalling. Checked again when her payment slip is uploaded.
 *
 * New table: created automatically by sequelize.sync() on server start.
 */
module.exports = (sequelize, DataTypes) => {
  const TrialOffer = sequelize.define(
    'TrialOffer',
    {
      userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
      percent: { type: DataTypes.INTEGER, allowNull: false },
      country: { type: DataTypes.STRING(80), allowNull: true },
      currency: { type: DataTypes.STRING(16), allowNull: true },
      // [{ planId, planTitle, durationId, days, listPrice, offerPrice, recommended }]
      items: { type: DataTypes.JSON, allowNull: false },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
      reminderSentAt: { type: DataTypes.DATE, allowNull: true },
      redeemedAt: { type: DataTypes.DATE, allowNull: true },
      redeemedPlanImageId: { type: DataTypes.INTEGER, allowNull: true },
    },
    { tableName: 'TrialOffers', timestamps: true }
  );
  return TrialOffer;
};
