module.exports = (sequelize, DataTypes) => {
  // Per-meal status row. Photos are NEVER stored server-side (Section 10
  // device-only policy). The client tracks photos in app-local storage and
  // never uploads — there is no `photoUrl` or `hasPhoto` column here on
  // purpose, to remove any temptation to leak that signal.
  const MealLog = sequelize.define(
    'MealLog',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Local date this meal belongs to (server-local PKT day).
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      mealType: {
        type: DataTypes.ENUM('breakfast', 'lunch', 'dinner'),
        allowNull: false,
      },
      // pending: not yet logged for current day (no row needed unless we
      // pre-create them via cron — we don't). followed/alternative/skipped
      // map to the 3 user-facing logging options.
      status: {
        type: DataTypes.ENUM('pending', 'followed', 'alternative', 'skipped'),
        allowNull: false,
        defaultValue: 'pending',
      },
      // Reason codes are 1-tap chips on the client, normalised here:
      //   alternative: traveling | no_ingredients | didnt_like_plan | hungry
      //                | family_meal | other
      //   skipped:     not_hungry | forgot | busy | felt_unwell | other
      reasonCode: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      // Free-text "what did you eat" for alternative meals.
      alternativeText: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      // Distinguishes original log timestamp from edits (Section 6.6 —
      // 7-day edit window enforced server-side via this + updatedAt).
      firstLoggedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      editCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: 'MealLogs',
      timestamps: true,
      indexes: [
        // Always-loaded query: today's meals for user X.
        { fields: ['userId', 'date'] },
        // Uniqueness so upserts can't double-log a meal slot.
        { unique: true, fields: ['userId', 'date', 'mealType'] },
      ],
    }
  );

  MealLog.associate = (models) => {
    MealLog.belongsTo(models.User, { foreignKey: 'userId' });
    models.User.hasMany(MealLog, { foreignKey: 'userId' });
  };

  return MealLog;
};
