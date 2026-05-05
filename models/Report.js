module.exports = (sequelize, DataTypes) => {
    const Report = sequelize.define('Report', {
        weight: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        currentWeight: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        weist: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
       
        hips: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        arms: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        shoulder: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        chest: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        abdoman: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        thighs: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        istDayDate: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        currentDate: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        aboutService: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        review: {
            type: DataTypes.STRING(),
            allowNull: true,
        },

       
    });

    // Each user can have one email verification code
    Report.associate = (models) => {
        
        // Category.hasMany(models.Plan);
        // models.Plan.belongsTo(Category);

    };

    return Report;
};
