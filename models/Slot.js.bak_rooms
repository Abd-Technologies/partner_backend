module.exports = (sequelize, DataTypes) => {
    const Slot = sequelize.define('Slot', {
        start: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        end: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        trainerLink: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        type: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        level: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        description: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        status: {
            type: DataTypes.TEXT('short'),
            allowNull: true,
        },
        token: {
            type: DataTypes.TEXT('long'), // or simply DataTypes.TEXT if you don't expect super large tokens
            allowNull: true,
        },


        isTrainerJoined: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        joinedUserUID: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        // Audit signal: who flipped status to Completed/Cancelled? NULL
        // means the auto-end cron did. See docs/Slot_Status_Audit_Signals.md
        // for the contract — both endpoints (manual updateSlotStatus and
        // the cron) MUST set this column to keep the signal queryable.
        completed_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        status_changed_at: {
            type: DataTypes.DATE,
            allowNull: true,
        }
        // trainerId: {
        //     type: DataTypes.INTEGER,
        //     allowNull: true,
        // },
    });

    // Each user can have one email verification code
    Slot.associate = (models) => {

        models.User.hasMany(Slot, { foreignKey: 'trainerId' });
        Slot.belongsTo(models.User, { foreignKey: 'trainerId' });
    };

    return Slot;
};
