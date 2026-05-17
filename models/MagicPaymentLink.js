/**
 * MagicPaymentLink — see migrations/20260512000001-create-magic-payment-links.js
 */
module.exports = (sequelize, DataTypes) => {
  const MagicPaymentLink = sequelize.define('MagicPaymentLink', {
    id:                 { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    token:              { type: DataTypes.STRING(64), allowNull: false, unique: true },
    PlanId:             { type: DataTypes.INTEGER, allowNull: true },
    PriceDurationId:    { type: DataTypes.INTEGER, allowNull: true },
    UserId:             { type: DataTypes.INTEGER, allowNull: true },
    phone:              { type: DataTypes.STRING(32), allowNull: true },
    crmLeadId:          { type: DataTypes.INTEGER, allowNull: true },
    listPrice:          { type: DataTypes.INTEGER, allowNull: false },
    paidAmount:         { type: DataTypes.INTEGER, allowNull: false },
    discountAmount:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    discountReason:     { type: DataTypes.STRING(120), allowNull: true },
    createdByRepId:     { type: DataTypes.INTEGER, allowNull: true },
    payerName:          { type: DataTypes.STRING(120), allowNull: true },
    payerRelationship:  { type: DataTypes.STRING(40), allowNull: true },
    status:             { type: DataTypes.ENUM('pending', 'opened', 'redeemed', 'expired', 'cancelled'), allowNull: false, defaultValue: 'pending' },
    expiresAt:          { type: DataTypes.DATE, allowNull: false },
    openedAt:           { type: DataTypes.DATE, allowNull: true },
    redeemedAt:         { type: DataTypes.DATE, allowNull: true },
    redeemedPlanImageId:{ type: DataTypes.INTEGER, allowNull: true },
    notes:              { type: DataTypes.TEXT, allowNull: true },
  }, {
    tableName: 'MagicPaymentLinks',
    timestamps: true,
  });

  MagicPaymentLink.associate = (models) => {
    if (models.Plan)           MagicPaymentLink.belongsTo(models.Plan,           { foreignKey: 'PlanId' });
    if (models.PriceDurations) MagicPaymentLink.belongsTo(models.PriceDurations, { foreignKey: 'PriceDurationId' });
    if (models.User)           MagicPaymentLink.belongsTo(models.User,           { foreignKey: 'UserId', as: 'redeemingUser' });
    if (models.User)           MagicPaymentLink.belongsTo(models.User,           { foreignKey: 'createdByRepId', as: 'creator' });
    if (models.PlanImage)      MagicPaymentLink.belongsTo(models.PlanImage,      { foreignKey: 'redeemedPlanImageId', as: 'planImage' });
  };

  return MagicPaymentLink;
};
