module.exports = (sequelize, DataTypes) => {
    const FreeTrailUsersSlots = sequelize.define('FreeTrailUsersSlots', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        freeTrialUserId: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        slotId: {
            type: DataTypes.INTEGER,
            allowNull: false,
        }
    }, {
        tableName: 'FreeTrailUsersSlots',
        timestamps: true,
        
    });

    FreeTrailUsersSlots.associate = (models) => {
        // Each slot assignment belongs to a slot
        FreeTrailUsersSlots.belongsTo(models.Slot, {
            foreignKey: 'slotId',
            as: 'slot',
        });

        // Each slot assignment belongs to a free trial user
        FreeTrailUsersSlots.belongsTo(models.FreeTrailUsers, {
            foreignKey: 'freeTrialUserId',
            as: 'freeUserSlots',
        });
    };

    return FreeTrailUsersSlots;
};

