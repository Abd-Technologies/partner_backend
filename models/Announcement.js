module.exports = (sequelize, DataTypes) => {
    const Announcement = sequelize.define('Announcement', {
        title: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        body: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
   

       
    });

    // Each user can have one email verification code
    Announcement.associate = (models) => {
        
       

    };

    return Announcement;
};
