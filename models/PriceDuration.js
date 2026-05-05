module.exports = (sequelize, DataTypes) => {
    const PriceDurations = sequelize.define('PriceDurations', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        duration: {
            type: DataTypes.STRING, // e.g., 'monthly', 'yearly'
            allowNull: false,
        }
    }, {
        tableName: 'PriceDurations',
        timestamps: true, // Enable timestamps for createdAt and updatedAt
    });

    // Define associations
    PriceDurations.associate = (models) => {
        // PriceDurations has a one-to-many relationship with Price
        PriceDurations.hasMany(models.Price, { foreignKey: 'durationId', as: 'priceDuration' });
        PriceDurations.hasOne(models.PlanImage);
        models.PlanImage.belongsTo(PriceDurations);
  //  PriceDurations.hasMany(models.UserPlan,{ foreignKey: 'durationIdPlan', as: 'priceDurationPlan' });
   // models.UserPlan.belongsTo(PriceDurations);

    
    };

    return PriceDurations;
};
