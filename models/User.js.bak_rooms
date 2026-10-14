module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define("User", {
    firstName: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    lastName: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    email: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    deviceToken: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    phone: {
      type: DataTypes.STRING(72),
      allowNull: true,
    },
    password: {
      type: DataTypes.STRING(),
      allowNull: true,
    },

    status: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
        usedFreeTrial: {
      type: DataTypes.BOOLEAN,
      default: false,
    },
    freeze: {
      type: DataTypes.BOOLEAN,
      default: false,
    },
    freezingDays: {
      type: DataTypes.INTEGER,
      default: false,
    },
    // Option-C feature flags: route individual users between the legacy
    // UserHomeScreen and the new V2 home screens. Default false so existing
    // users remain on the old screen. Flip per-user via SQL or admin tool.
    useNewPaidHome: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    useNewUnpaidHome: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // Phase A — Progress Screen rebuild. Routes the user between the legacy
    // 2-tab progress_screen.dart (Weekly Progress / Photo Library) and the
    // new single-scroll Progress hub. Default false so existing users stay
    // on the old screen until product flips them in beta.
    useNewProgressHub: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    // PaidHomeScreenV2 — Phase A. User's target weight in kg. Nullable; when
    // null the goal chip on the dashboard renders a "Set goal" fallback.
    targetWeightKg: {
      type: DataTypes.FLOAT,
      allowNull: true,
      defaultValue: null,
    },
    // 'lose' | 'gain' | null. Only needed when mainGoal doesn't already
    // say which direction weight should move (mainGoal === 'Lose weight'
    // implies 'lose' on its own) — captured explicitly when the user
    // sets a target weight, so the Weight trend card on the home screen
    // knows whether a delta is good news or a heads-up instead of
    // guessing from the number alone.
    weightGoalDirection: {
      type: DataTypes.STRING(10),
      allowNull: true,
      defaultValue: null,
    },
    customSupporter: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    userType: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    age: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    
    weight: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    
    height: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    bmiResult: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    mainGoal: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    healthConditions: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },

    speciality: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    totalPatients: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    experience: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    image: {
      type: DataTypes.STRING(),
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT('LONG'),
      allowNull: true,
    },
    usedFreezeOption: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
        },
	  
    /**
     * IANA timezone name. Drives push notifications, "today's meals",
     * streak resets, and any cycle/meal scheduling done by the
     * dietitian. NEVER store offsets (e.g. "+05:00") or abbreviations
     * (e.g. "PKT") — only IANA zone names like "Asia/Karachi",
     * "Europe/London", "America/New_York".
     *
     * Field name is camelCase (`timeZone`) for backward-compat: legacy
     * controllers (AdminController, DashboardController, crownjobfunction)
     * already read `user.timeZone`. Spec called for `timezone` lowercase
     * but renaming would require touching those controllers — out of
     * scope for Phase B per the "don't modify controllers" rule.
     */
    timeZone: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'Asia/Karachi',
      validate: {
        isValidIana(value) {
          const moment = require('moment-timezone');
          if (!moment.tz.zone(value)) {
            throw new Error(`Invalid IANA timezone: ${value}`);
          }
        },
      },
    },
  caloriesCounter: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    },
  mainGoal: {
    type: DataTypes.STRING,
    allowNull: true,
    },

  });

  User.associate = (models) => {
    User.hasMany(models.UserPlan, { foreignKey: 'userId' });
    models.UserPlan.belongsTo(User, { foreignKey: 'userId' });

User.belongsTo(User, {
  as: 'supporter', // alias
  foreignKey: 'customSupporter',
});
User.hasMany(User, {
  as: 'clients',
  foreignKey: 'customSupporter',
});


    User.hasOne(models.PlanImage);
    models.PlanImage.belongsTo(User);

    User.hasMany(models.AssignedPlan);
    models.AssignedPlan.belongsTo(User);

    User.hasMany(models.HealthTips);
    models.HealthTips.belongsTo(User);
    // User.hasMany(models.UserReview);
    // models.UserReview.belongsTo(User);

    User.hasMany(models.ProgressImage);
    models.ProgressImage.belongsTo(User);

    User.hasMany(models.Review, { foreignKey: 'userId' });
    models.Review.belongsTo(User, { foreignKey: 'userId' });
    User.hasMany(models.Review, { foreignKey: 'trainerOrDiet' });
    models.Review.belongsTo(User, { foreignKey: 'trainerOrDiet' });

    User.hasMany(models.Report, { foreignKey: 'userId' });
    models.Report.belongsTo(User, { foreignKey: 'userId' });

    // Re-enabled — these were commented out (likely to dodge an alias
    // collision with the plain `User.hasMany(models.UserPlan, {
    // foreignKey: 'userId' })` above, which defaults to the "UserPlans"
    // alias). Using distinct `as` on the hasMany side avoids that
    // collision. Without the `belongsTo` half, Sequelize never learns
    // that `trainerId`/`dietitianId` are real attributes on UserPlan —
    // so `payment_success` in AdminController.js (which does
    // `userPlan.trainerId = ...; userPlan.dietitianId = ...; .save()`)
    // was silently a no-op for both columns: Sequelize only persists
    // declared/dirty attributes, so an undeclared property assignment
    // never reaches the UPDATE statement. Net effect: a user whose
    // workout+diet package purchase was approved never actually got a
    // dietitianId written to their UserPlan row, so
    // getMyBookingContext (dietPlanController.js) could never resolve
    // a dietitian for her and the client fell back to the plans/
    // paywall screen instead of showing consultation slots.
    User.hasMany(models.UserPlan, {
      as: 'TrainerAssignments',
      onDelete: 'cascade',
      foreignKey: 'trainerId',
    });
    models.UserPlan.belongsTo(User, { as: 'Trainer', foreignKey: 'trainerId' });

    User.hasMany(models.UserPlan, {
      as: 'DietitianAssignments',
      onDelete: 'cascade',
      foreignKey: 'dietitianId',
    });
    models.UserPlan.belongsTo(User, { as: 'Dietition', foreignKey: 'dietitianId' });
    User.hasMany(models.UserReview, { onDelete: "cascade", foreignKey: "dietitianId", });
    models.UserReview.belongsTo(User, { as: "Dietition", foreignKey: "dietitianId" });

    User.hasMany(models.AssignedPlan, { onDelete: "cascade", foreignKey: "dietitianId", });
    models.AssignedPlan.belongsTo(User, { as: "Dietition", foreignKey: "dietitianId" });

    User.hasMany(models.AssignedPlan, { onDelete: "cascade", foreignKey: "trainerId", });
    models.AssignedPlan.belongsTo(User, { as: "Trainer", foreignKey: "trainerId" });

    // User.hasMany(models.pdfDietsForUser, { foreignKey: 'userId'});
    // models.pdfDietsForUser.belongsTo(User, { foreignKey: 'userId' });
    User.hasMany(models.SlotDiet, { foreignKey: 'dietitionId' });
    models.SlotDiet.belongsTo(User, { foreignKey: 'dietitionId' });

  };

  return User;
};

