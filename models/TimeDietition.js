module.exports = (sequelize, DataTypes) => {
    const TimeDietition = sequelize.define('TimeDietition', {
        day: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        // start: {
        //     type: DataTypes.STRING(),
        //     allowNull: true,
        // },
        // end: {
        //     type: DataTypes.STRING(),
        //     allowNull: true,
        // },
        // dietitionLink: {
        //     type: DataTypes.TEXT('long'),
        //     allowNull: true,
        // },
        // trainerLink: {
        //     type: DataTypes.TEXT('long'),
        //     allowNull: true,
        // },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },   
    });

    // Each user can have one email verification code
    TimeDietition.associate = (models) => {
        
        TimeDietition.hasMany(models.SlotDiet);
        models.SlotDiet.belongsTo(TimeDietition);
       

    };

    return TimeDietition;
};
