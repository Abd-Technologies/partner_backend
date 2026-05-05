module.exports = (sequelize, DataTypes) => {
    const HealthTips = sequelize.define('HealthTips', {
        image: {
            type: DataTypes.TEXT('text'),
            allowNull: true,
        },
        title: {
            type: DataTypes.TEXT('text'),
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
    }, {
        // Disable automatic timestamps
        timestamps: false,
    });

    HealthTips.associate = (models) => {
        // Define associations here if needed
    };

    return HealthTips;
};
