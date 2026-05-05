module.exports = (sequelize, DataTypes) => {
    const Contact = sequelize.define('Contact', {
        firstName: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        lastName: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        email: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        subject: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        message: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },

        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },


    });

    // Each user can have one email verification code
    Contact.associate = (models) => {


    };

    return Contact;
};
