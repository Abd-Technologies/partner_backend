module.exports = (sequelize, DataTypes) => {
    const ProgressImage = sequelize.define('ProgressImage', {
        before: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        after: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },

       
    });

    // Each user can have one email verification code
    ProgressImage.associate = (models) => {
        
       

    };

    return ProgressImage;
};
