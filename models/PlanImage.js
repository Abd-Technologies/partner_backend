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
  