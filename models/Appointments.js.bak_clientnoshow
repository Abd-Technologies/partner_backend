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

        // Meet attendance tracking (migration 20260916150000). Populated
        // by services/meetAttendance after the appointment's scheduled
        // time passes — see that migration file for what each column
        // means. All nullable; null = "not checked yet" or "couldn't
        // tell", never assume it means false.
        meetAttendanceCheckedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        meetDietitianAttended: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        meetClientAttended: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
        meetConferenceRecordName: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        meetAttendanceRaw: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },

        // Snapshot of SlotDiet.dietitionLink taken the moment this
        // appointment is confirmed (migration 20260920160000). Exists
        // because dietitionLink lives on the recurring weekly slot
        // template, shared by every week's booking into it — without a
        // snapshot, updating the slot's link would live-affect every
        // other currently-confirmed appointment against that same slot,
        // even a different client's different week. Null for legacy
        // rows confirmed before this existed, or if the slot had no
        // link yet at confirm time — callers should fall back to
        // SlotDiet.dietitionLink in that case, never assume "no link at
        // all".
        meetLink: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },

        // Set the moment a "pending" (never-confirmed) appointment gets
        // auto-canceled because its scheduled time passed with the
        // dietitian never responding at all (migration 20260921120000).
        // Distinct from noShowReportedAt: that one means "confirmed but
        // she never joined"; this one means "never even confirmed it in
        // the first place". Both end up status:"canceled", but the
        // client sees a different message for each, and they're logged
        // as separate escalation triggers so Shaista can tell the two
        // apart in her history.
        expiredAt: {
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
