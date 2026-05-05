module.exports = (sequelize, DataTypes) => {
    const SlotDiet = sequelize.define('SlotDiet', {
        start: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        end: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
        dietitionLink: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        // isAvailble (typo) was previously declared with the wrong default
        // syntax (`default` instead of `defaultValue`) and never written
        // by any code path. The actual "is this slot booked?" check runs
        // off the Appointment table — see appointmentController.createAppointment.
        // Column dropped in migration 20260503130000-drop-isAvailble-from-slotdiets.
    });

    // Each user can have one email verification code
    SlotDiet.associate = (models) => {
        models.User.hasMany(SlotDiet, { foreignKey: 'dietitionId' });
        SlotDiet.belongsTo(models.User, { foreignKey: 'dietitionId' });

    };

    return SlotDiet;
};
