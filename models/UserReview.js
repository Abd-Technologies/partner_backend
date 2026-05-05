module.exports = (sequelize, DataTypes) => {
    const UserReview = sequelize.define('UserReview', {

        comment: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        value: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
    });

    // // Each user can have one email verification code
    UserReview.associate = (models) => {

       
    };

    return UserReview;
};
