module.exports = (sequelize, DataTypes) => {
    const Diet = sequelize.define('Diet', {
        time: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        food: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        calories: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },

       
    });

    // Each user can have one email verification code
    Diet.associate = (models) => {
       
    };

    return Diet;
};
