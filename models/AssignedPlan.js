module.exports = (sequelize, DataTypes) => {
    const AssignedPlan = sequelize.define('AssignedPlan', {
      
    });

    // Each user can have one email verification code
    AssignedPlan.associate = (models) => {
        
        // Category.hasMany(models.Plan);
        // models.Plan.belongsTo(Category);

    };

    return AssignedPlan;
};
