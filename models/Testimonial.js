module.exports = (sequelize, DataTypes) => {
    const Testimonial = sequelize.define('Testimonial', {
        image: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },


    });

    // Each user can have one email verification code
    Testimonial.associate = (models) => {


    };

    return Testimonial;
};
