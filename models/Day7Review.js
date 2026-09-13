module.exports = (sequelize, DataTypes) => {
  // Cycle review (Day 7 + Day 22 of a 30-day plan). The flag thresholds
  // were locked in Decision 6:
  //   adherencePct < 40           → LOW_ADHERENCE
  //   painReported === true        → PAIN_REPORTED
  //   severeSideEffectsReported    → SEVERE_SIDE_EFFECTS
  //   satisfaction < 2             → LOW_SATISFACTION
  // Any one tripped → flagged=true, escalates to admin via EscalationTicket
  // (REVIEW_FLAG) at the controller layer.
  const Day7Review = sequelize.define(
    'Day7Review',
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
      userPlanId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      // Which review within the plan: cycle 1 = Day 7 review, cycle 2 = Day 22.
      cycle: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      planType: {
        type: DataTypes.ENUM('diet', 'workout', 'combined'),
        allowNull: false,
      },

      // ── Diet section (null on workout-only) ─────────────────────────
      adherencePct: {
        type: DataTypes.INTEGER, // 0..100
        allowNull: true,
      },
      mealsStruggled: {
        type: DataTypes.JSON, // ["breakfast","dinner"]
        allowNull: true,
      },
      hungerLevel: {
        type: DataTypes.ENUM('always_hungry', 'just_right', 'too_full'),
        allowNull: true,
      },
      sideEffects: {
        type: DataTypes.JSON, // ["bloating","headaches","cravings","none"]
        allowNull: true,
      },

      // ── Workout section (null on diet-only) ─────────────────────────
      difficultyLevel: {
        type: DataTypes.ENUM('too_easy', 'just_right', 'too_hard'),
        allowNull: true,
      },
      sessionTimingIssues: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
      },

      // ── Shared / flag inputs ───────────────────────────────────────
      painReported: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      painLocation: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      severeSideEffectsReported: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      satisfaction: {
        type: DataTypes.INTEGER, // 1..5
        allowNull: true,
      },

      // ── Computed at save time (see hook below) ─────────────────────
      flagged: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      flagReasons: {
        type: DataTypes.JSON, // ["LOW_ADHERENCE","PAIN_REPORTED",...]
        allowNull: false,
        defaultValue: [],
      },

      // ── Staff acknowledgment (separate from the computed `flagged`
      // fact above) ───────────────────────────────────────────────────
      // `flagged` is recomputed from raw fields on every save by the
      // beforeSave hook below, so it can never be directly "cleared" —
      // the next save would just re-derive it back to true. These two
      // columns record "a human dealt with this" independently, the
      // same way PendingPopupState.completedAt records completion
      // without touching the eligibility computation. Set together by
      // escalationAdminController.js::resolveTicket when a REVIEW_FLAG
      // ticket is resolved. NULL means still open/unaddressed.
      flagResolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      flagResolvedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      tableName: 'Day7Reviews',
      timestamps: true,
      indexes: [
        { fields: ['userId', 'userPlanId', 'cycle'] },
        { fields: ['flagged'] },
      ],
    }
  );

  // Auto-flag computation. Run on every save so server is the only source
  // of truth for the flag — clients can't bypass by omitting `flagged` in
  // the request body. Decision-6 thresholds locked.
  Day7Review.addHook('beforeSave', (review) => {
    const reasons = [];
    if (review.adherencePct != null && Number(review.adherencePct) < 40) {
      reasons.push('LOW_ADHERENCE');
    }
    if (review.painReported === true) {
      reasons.push('PAIN_REPORTED');
    }
    if (review.severeSideEffectsReported === true) {
      reasons.push('SEVERE_SIDE_EFFECTS');
    }
    if (review.satisfaction != null && Number(review.satisfaction) < 2) {
      reasons.push('LOW_SATISFACTION');
    }
    review.flagged = reasons.length > 0;
    review.flagReasons = reasons;
  });

  Day7Review.associate = (models) => {
    Day7Review.belongsTo(models.User, { foreignKey: 'userId' });
    Day7Review.belongsTo(models.UserPlan, { foreignKey: 'userPlanId' });
  };

  return Day7Review;
};
