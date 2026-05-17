module.exports = (sequelize, DataTypes) => {
    const PlanImage = sequelize.define('PlanImage', {
      image: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      price: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      status: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },

      // ─── Extended fields for discount support + magic link integration ───
      // See migration 20260512000001-create-magic-payment-links.js
      listPrice:          { type: DataTypes.INTEGER, allowNull: true },
      paidAmount:         { type: DataTypes.INTEGER, allowNull: true },
      discountAmount:     { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      discountReason:     { type: DataTypes.STRING(120), allowNull: true },
      uploadedByRepId:    { type: DataTypes.INTEGER, allowNull: true },
      uploadSource:       { type: DataTypes.ENUM('user_app', 'rep_crm', 'magic_link'), allowNull: false, defaultValue: 'user_app' },
      magicPaymentLinkId: { type: DataTypes.INTEGER, allowNull: true },
      payerName:          { type: DataTypes.STRING(120), allowNull: true },
      payerRelationship:  { type: DataTypes.STRING(40),  allowNull: true },
      ocrData:            { type: DataTypes.JSON,        allowNull: true },
      ocrConfidence:      { type: DataTypes.DECIMAL(4, 3), allowNull: true },

      // OCR-extracted details promoted to top-level columns (added in migration 20260512000002)
      // — easier to query, index, and display in admin queue without JSON parsing.
      ocrAmount:          { type: DataTypes.INTEGER,     allowNull: true },
      ocrBank:            { type: DataTypes.STRING(80),  allowNull: true },
      ocrDate:            { type: DataTypes.STRING(40),  allowNull: true },
      ocrSender:          { type: DataTypes.STRING(120), allowNull: true },
      ocrTransactionId:   { type: DataTypes.STRING(80),  allowNull: true },
    });
    
  
    PlanImage.associate = (models) => {
      // A PlanImage belongs to a Plan
    //   PlanImage.belongsTo(models.Plan, {
    //     foreignKey: 'planId', // Ensure this matches your `Plan` association
    //     as: 'plan', // Optional alias
    //   });
    };
  

    return PlanImage;
  };
  