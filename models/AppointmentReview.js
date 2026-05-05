module.exports = (sequelize, DataTypes) => {
    // One review per consultation. The user-side rating + comment that
    // gets aggregated into the admin dashboard's "reviews" panel.
    //
    // Distinct from the existing dietitian-level review (POST
    // /admin/addDietitionReview) — that's a profile rating across
    // everything; this is per-Appointment so the admin can see which
    // specific consultations went well or poorly.
    const AppointmentReview = sequelize.define('AppointmentReview', {
        rating: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        comment: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
    }, {
        indexes: [
            { unique: true, fields: ['appointmentId'] },
        ],
    });

    AppointmentReview.associate = (models) => {
        // One Appointment → at most one review.
        AppointmentReview.belongsTo(models.Appointment, { foreignKey: 'appointmentId' });
        models.Appointment.hasOne(AppointmentReview, { foreignKey: 'appointmentId' });

        // Reviewer = the client who attended the consultation.
        AppointmentReview.belongsTo(models.User, { foreignKey: 'userId', as: 'Reviewer' });
        models.User.hasMany(AppointmentReview, { foreignKey: 'userId' });
    };

    return AppointmentReview;
};
