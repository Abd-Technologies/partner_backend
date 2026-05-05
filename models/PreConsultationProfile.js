module.exports = (sequelize, DataTypes) => {
  // One profile per user. Persists across plan renewals — not tied to a
  // single plan cycle. Captured before the initial dietitian consultation;
  // editable later by the user (settings) and the dietitian (admin panel).
  const PreConsultationProfile = sequelize.define(
    'PreConsultationProfile',
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      // ── Required (per locked Decision 7) ────────────────────────────
      // goals: single-select string ("weight_loss" | "weight_gain" |
      // "maintain" | "pcos_management" | "postpartum" | "pregnancy_prep" |
      // "general_wellness"). Stored as STRING so future product additions
      // don't need a migration.
      goals: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      allergies: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // pregnancyMenstrualStatus: includes "prefer_not_to_say" per cultural
      // sensitivity. Free-form so we can refine values without migration.
      pregnancyMenstrualStatus: {
        type: DataTypes.STRING(64),
        allowNull: true,
      },
      // dietaryPreferences: multi-select stored as JSON array.
      dietaryPreferences: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      medicalConditions: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // ── Optional ────────────────────────────────────────────────────
      familyHistory: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      lifestyle: {
        type: DataTypes.JSON, // {workHours, sleepPattern, activityLevel, smoking, alcohol}
        allowNull: true,
      },
      fastingHabits: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      surgeries: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      currentMedications: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // ── Workout section (combined / workout-only plans) ─────────────
      // {fitnessLevel, injuries[], equipment[]}. NULL for diet-only plans.
      workoutSection: {
        type: DataTypes.JSON,
        allowNull: true,
      },

      // ── Dietitian-private notes ─────────────────────────────────────
      // Array of {authorId, authorName, text, timestamp}. Never returned
      // to the user. Append-only on the API surface.
      dietitianComments: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: [],
      },

      // ── Audit ──────────────────────────────────────────────────────
      // Multi-step form auto-save (per locked Decision 5) — UI shows
      // resume vs restart based on whether the form is complete.
      stepsCompleted: {
        type: DataTypes.JSON, // {goals: true, health: false, ...}
        allowNull: true,
        defaultValue: {},
      },
      isComplete: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      lastUserUpdate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastDietitianEdit: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: 'PreConsultationProfiles',
      timestamps: true,
      indexes: [{ unique: true, fields: ['userId'] }],
    }
  );

  PreConsultationProfile.associate = (models) => {
    PreConsultationProfile.belongsTo(models.User, { foreignKey: 'userId' });
    models.User.hasOne(PreConsultationProfile, { foreignKey: 'userId' });
  };

  return PreConsultationProfile;
};
