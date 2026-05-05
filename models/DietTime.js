module.exports = (sequelize, DataTypes) => {
    const DietTime = sequelize.define('DietTime', {
        day: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },   
    });

    // Each user can have one email verification code
    DietTime.associate = (models) => {
        
        DietTime.hasMany(models.Diet);
        models.Diet.belongsTo(DietTime);
       

    };

    return DietTime;
};
