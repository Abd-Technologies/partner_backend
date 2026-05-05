module.exports = (sequelize, DataTypes) => {
    const Review = sequelize.define('Review', {
        comment: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        classReview: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        value: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },


    });

    // Each user can have one email verification code
    Review.associate = (models) => {


    };

    return Review;
};
