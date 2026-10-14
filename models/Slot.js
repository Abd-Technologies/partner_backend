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
        // The class's meeting (Zoom number or a web link).
        //
        // Stored value = the trainer's Zoom room, kept in sync by the
        // server (hook below + POST /admin/trainerRoom). Trainers never
        // paste it any more.
        //
        // SAFETY: when read (API responses, socket, push payloads) it is
        // ONLY returned while the class is live ("In Progress"); any other
        // time it reads as null, so nobody can join early or share it.
        // While live it returns today's backup link if the trainer set one,
        // else her Zoom room. Server code that needs the stored value uses
        // slot.getDataValue('trainerLink') / slot.effectiveLink().
        trainerLink: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
            get() {
                if (this.getDataValue('status') !== 'In Progress') return null;
                return this.effectiveLink();
            },
        },
        // Trainer's "Other link" for ONE day (PKT date). Hidden from every
        // response; read with getDataValue.
        backupLink: {
            type: DataTypes.TEXT,
            allowNull: true,
            get() { return undefined; },
        },
        backupLinkDate: {
            type: DataTypes.STRING(10),
            allowNull: true,
            get() { return undefined; },
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

    const todayPkt = () => {
        const moment = require('moment-timezone');
        return moment.tz('Asia/Karachi').format('YYYY-MM-DD');
    };

    /** Today's backup link (if set for today), else the Zoom room. */
    Slot.prototype.effectiveLink = function () {
        const backup = this.getDataValue('backupLink');
        if (backup && this.getDataValue('backupLinkDate') === todayPkt()) return backup;
        const room = this.getDataValue('trainerLink');
        return room && String(room).trim() ? String(room).trim() : null;
    };
    /** True when today's class uses the trainer's backup link. */
    Slot.prototype.usesBackupLink = function () {
        return !!(this.getDataValue('backupLink') && this.getDataValue('backupLinkDate') === todayPkt());
    };

    // New class, or a class given to another trainer: copy that trainer's
    // Zoom room in, so the trainer profile stays the one truth.
    Slot.addHook('beforeSave', async (slot) => {
        if (!(slot.isNewRecord || slot.changed('trainerId'))) return;
        const trainerId = slot.getDataValue('trainerId');
        if (!trainerId) return;
        try {
            const trainer = await sequelize.models.User.findByPk(trainerId, { attributes: ['id', 'zoomRoom'] });
            if (trainer && trainer.zoomRoom) slot.setDataValue('trainerLink', trainer.zoomRoom);
        } catch (_) { /* keep whatever was there */ }
    });

    // Each user can have one email verification code
    Slot.associate = (models) => {

        models.User.hasMany(Slot, { foreignKey: 'trainerId' });
        Slot.belongsTo(models.User, { foreignKey: 'trainerId' });
    };

    return Slot;
};
