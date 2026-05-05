module.exports = (sequelize, DataTypes) => {
    const Countries = sequelize.define('Countries', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        code: {
            type: DataTypes.STRING, // e.g., 'PK', 'US'
            allowNull: false,
        },
            currency: {
            type: DataTypes.STRING, // e.g., 'PK', 'US'
            allowNull: false,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
    }, {
        tableName: 'Countries',
        timestamps: true, // Set to true if you need createdAt and updatedAt timestamps
    });

    // Define associations
    Countries.associate = (models) => {
        // Example association if needed
        Countries.hasMany(models.Price, { foreignKey: 'countryId',as: 'country' });
    };

    return Countries;
};
