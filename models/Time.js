module.exports = (sequelize, DataTypes) => {
    const Time = sequelize.define('Time', {
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
    Time.associate = (models) => {
        
        Time.hasMany(models.Slot);
        models.Slot.belongsTo(Time);
       

    };

    return Time;
};
