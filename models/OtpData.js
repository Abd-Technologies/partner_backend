module.exports = (sequelize, DataTypes) =>{
    const OtpData = sequelize.define('OtpData', {
        otp: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        email: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        requestAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
          },
        // Wrong tries for the current code; 5 cancel it (helper/otpStore.js).
        otpTries: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        
    });
    OtpData.associate = (models)=>{
        
    };
    return OtpData;
};
