module.exports = (sequelize, DataTypes) => {
    const Service = sequelize.define('Service', {
        title: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
       
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },

        desc: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
    });

    // Each user can have one email verification code
    Service.associate = (models) => {
       

    };

    return Service;
};
