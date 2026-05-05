module.exports = (sequelize, DataTypes) => {
    const Guest = sequelize.define('Guest', {
        name: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        email: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        phone: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
       
        result: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
    });

    // Each user can have one email verification code
    Guest.associate = (models) => {
        
        // Category.hasMany(models.Plan);
        // models.Plan.belongsTo(Category);

    };

    return Guest;
};
