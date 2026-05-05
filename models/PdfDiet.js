module.exports = (sequelize, DataTypes) => {
  const PdfDiet = sequelize.define('PdfDietsForUserNew', {
    date: {
      type: DataTypes.DATE,
      allowNull: false,
  },
    pdfFile: {
      type: DataTypes.STRING, // Path or name of the PDF file
      allowNull: false, // This should not be null
    },
    status: {
      type: DataTypes.BOOLEAN,
      allowNull: false, // This should not be null
      defaultValue: true,
    },

    dietStatus: {
      type: DataTypes.ENUM('pending', 'delayed', 'completed', 'canceled'),
      defaultValue: 'pending',
  },
  });

  
  // Associations
  PdfDiet.associate = (models) => {
    PdfDiet.belongsTo(models.User, { foreignKey: 'userId' });

      models.UserPlan.hasMany(PdfDiet, { foreignKey: 'userPlanId' });

    PdfDiet.belongsTo(models.UserPlan, { foreignKey: 'userPlanId' }); 
  };

  return PdfDiet;
};
