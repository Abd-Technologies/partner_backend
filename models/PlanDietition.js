module.exports = (sequelize, DataTypes) => {
    const PlanDietition = sequelize.define('PlanDietition', {

       
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },


    });

    // Each user can have one email verification code
    PlanDietition.associate = (models) => {

    };

    return PlanDietition;
};
