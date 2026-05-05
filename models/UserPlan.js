module.exports = (sequelize, DataTypes) => {
    const UserPlan = sequelize.define('UserPlan', {

        buyingDate: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        expireDate: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        planStatus: {
            type: DataTypes.STRING(),
            allowNull: true,
        },
       

        price: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        dietitionLink: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
        },
        // trainerLink: {
        //     type: DataTypes.TEXT('long'),
        //     allowNull: true,
        // },
        status: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
durationIdPlan: {
  type: DataTypes.INTEGER,
  allowNull: true,
},
     usedFreezeOption: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },

        // ── Freeze v2 columns (user-button flow). See
        // docs/Freeze_Logic_Audit.md §5.3. The legacy User.freeze /
        // freezingDays / usedFreezeOption columns stay in place — old
        // POST /admin/freeze handler still uses them. New endpoints
        // (POST /users/plan/freeze etc) use only the columns below.
        // frozenAt IS NULL is the canonical "not frozen" signal.
        frozenAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        freezeDays: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        // Cumulative counter — total days ever spent frozen on this
        // plan. Compared against originalDurationDays at freeze time
        // so a user can never freeze more days than the plan was
        // originally bought for.
        totalFrozenDays: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        // Snapshot of (expireDate - buyingDate) taken at first freeze.
        // Persisted so subsequent freezes (which see an already-extended
        // expireDate) can still validate against the original.
        originalDurationDays: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        // Used for the cooldown check (1-day default).
        lastUnfrozenAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        // Audit signals mirroring Slot.completed_by / Appointment.completed_by.
        // NULL on legacy rows (POST /admin/freeze never writes these).
        // NULL on unfrozenBy means the auto-unfreeze cron flipped it.
        frozenBy: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        unfrozenBy: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

        // ── Consultation-flow cycle anchors (Section 4) ─────────────
        // Pop-up eligibility offsets (Day 3-4 early checkin, Day 7
        // review, Day 15/30 progress) are computed against
        // firstPlanDeliveredAt for cycle 1 and against
        // latestPlanDeliveredAt for cycle 2. Phase 1A migration adds
        // these as nullable to UserPlans.
        firstPlanDeliveredAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        latestPlanDeliveredAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        cycle1StartedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        cycle2StartedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },

    });

    // Each user can have one email verification code
    UserPlan.associate = (models) => {

        //userplanid is used in wallet table for future use
        // UserPlan.hasOne(models.Wallet);
        // models.Wallet.belongsTo(UserPlan);
    
        //userplanid is used in wallet table for future use
        UserPlan.hasMany(models.PlanDietition);
        models.PlanDietition.belongsTo(UserPlan);

        // UserPlan.hasMany(models.DietTime);
        // models.DietTime.belongsTo(UserPlan);
// UserPlan.hasOne(models.pdfDietsForUser, { foreignKey: 'userPlanId'});
// models.pdfDietsForUser.belongsTo(UserPlan, { foreignKey: 'userPlanId' });

    };

    return UserPlan;
};
