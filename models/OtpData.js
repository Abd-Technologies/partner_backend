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
        
    });
    OtpData.associate = (models)=>{
        
    };
    return OtpData;
};
