module.exports = (sequelize, DataTypes) => {
    const Price = sequelize.define('Price', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        priceAmount: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        durationId: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        countryId: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
            isDefault: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
        planId: {
            type: DataTypes.INTEGER,
            allowNull: true,
        }
    }, {
        tableName: 'Prices',
        timestamps: true, // Enable timestamps for createdAt and updatedAt
    });

    // Define associations
    Price.associate = (models) => {
        Price.belongsTo(models.Countries, { foreignKey: 'countryId', as: 'country' });
        Price.belongsTo(models.PriceDurations, { foreignKey: 'durationId', as: 'priceDuration' });
        Price.belongsTo(models.Plan, { foreignKey: 'planId', as: 'plan' });

        // Setting up hasMany relationships in the related models
        models.Countries.hasMany(Price, { foreignKey: 'countryId', as: 'prices' });
        models.PriceDurations.hasMany(Price, { foreignKey: 'durationId', as: 'prices' });
        models.Plan.hasMany(Price, { foreignKey: 'planId', as: 'prices' });
    };

    return Price;
};
