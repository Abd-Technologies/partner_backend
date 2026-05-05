module.exports = (sequelize, DataTypes) => {
  const Plan = sequelize.define("Plan", {
    title: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    shortDescription: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    longDescription: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    // duration: {
    //   type: DataTypes.STRING(),
    //   allowNull: true,
    // },
    // price: {
    //   type: DataTypes.INTEGER,
    //   allowNull: true,
    // },

    status: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    dietitianId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    image: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
  });

  // Each user can have one email verification code
  Plan.associate = (models) => {
    Plan.hasMany(models.UserPlan);
    models.UserPlan.belongsTo(Plan);
    
    Plan.hasMany(models.Review);
    models.Review.belongsTo(Plan);
    
    Plan.hasOne(models.PlanImage);
    models.PlanImage.belongsTo(Plan);


    // Plan.hasMany(models.Time);
    // models.Time.belongsTo(Plan);

    Plan.hasMany(models.AssignedPlan);
    models.AssignedPlan.belongsTo(Plan);
    Plan.hasMany(models.Price, { foreignKey: 'planId' }); // A plan can have multiple prices
    models.Price.belongsTo(Plan, { foreignKey: 'planId' }); 
  };

  return Plan;
};
