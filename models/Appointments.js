module.exports = (sequelize, DataTypes) => {
    //reshadule,,datetime
    const Appointment = sequelize.define('Appointment', {

        date: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('pending', 'confirmed', 'In Progress', 'completed', 'canceled', "canceledByUser"),
            defaultValue: 'pending',
        },
        planId:{
            type:DataTypes.INTEGER,
            allowNull: true,

        },
        reschedule: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
          },

        message:{
            type:DataTypes.STRING,
            allowNull: true,
        },

        // Audit signal: who flipped status to In Progress / Completed /
        // Canceled? NULL means the auto-end cron did. Mirrors Slot.completed_by
        // (see docs/Slot_Status_Audit_Signals.md). Both manual endpoints
        // (updateAppointment, startAppointment) and the cron MUST set this
        // column to keep the manual-vs-auto signal queryable.
        completed_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        status_changed_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },

        // Consultation-flow extensions (Phase 1A migration
        // 20260505000001). Distinguishes initial (post-purchase) from
        // followup (Day 15) consultations and stamps user-reported no-show.
        // Nullable so legacy rows don't need backfill.
        kind: {
            type: DataTypes.ENUM('initial', 'followup'),
            allowNull: true,
        },
        noShowReportedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },

    });

    Appointment.associate = (models) => {
        // Each Client can have many Appointments
        Appointment.belongsTo(models.User, { foreignKey: 'userId' , as:"ClientUser"});
        models.User.hasMany(Appointment, { foreignKey: 'userId',as:"ClientAppointments" });

        // Each TeamMember can have many Appointments
        Appointment.belongsTo(models.User, { foreignKey: 'dietitionId' });
        models.User.hasMany(Appointment, { foreignKey: 'dietitionId' });

        // Each TimeSlot can have many Appointments
        Appointment.belongsTo(models.SlotDiet, { foreignKey: 'timeSlotId' });
        models.SlotDiet.hasMany(Appointment, { foreignKey: 'timeSlotId' });
    };

    return Appointment;
};
