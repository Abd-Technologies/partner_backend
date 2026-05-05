module.exports = (sequelize, DataTypes) => {
    const FreeTrailUsers = sequelize.define('FreeTrailUsers', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        mainGoal: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        specificIssues: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        prefrences: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        freeTrialUser: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
     //   slotsId: {
       //     type: DataTypes.ARRAY(DataTypes.INTEGER),
       //     allowNull: true,
       // },
    }, {
        tableName: 'FreeTrailUsers',
        timestamps: true,
    });

    FreeTrailUsers.associate = (models) => {
        FreeTrailUsers.belongsTo(models.User, {
            foreignKey: 'freeTrialUser',
            as: 'freeUserId',
        });

        FreeTrailUsers.hasMany(models.FreeTrailUsersSlots, {
            foreignKey: 'freeTrialUserId',
            as: 'freeUserSlots', // 👈 match this in your include
          });
    };

    return FreeTrailUsers;
};
