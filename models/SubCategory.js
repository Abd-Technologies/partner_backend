module.exports = (sequelize, DataTypes) => {
    const SubCategory = sequelize.define('SubCategory', {
        title: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },

       
    });

    // Each user can have one email verification code
    SubCategory.associate = (models) => {
        
        SubCategory.hasMany(models.Plan);
        models.Plan.belongsTo(SubCategory);

    };

    return SubCategory;
};
