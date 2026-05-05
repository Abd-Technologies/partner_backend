module.exports = (sequelize, DataTypes) => {
  // One row per (user, popup variable). The eligibility computer
  // (helper/popupEligibility.js — Phase 1C) writes here; the dashboard
  // endpoint reads here to populate `pendingPopups`. Dismiss/complete
  // endpoints also write here. Single source of truth so the client never
  // computes "should I show X?" itself.
  const PendingPopupState = sequelize.define(
    'PendingPopupState',
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
      // Variable name from Section 11 of the architecture doc, e.g.
      // POPUP_DAY7_REVIEW. We store as STRING (not ENUM) so adding a new
      // popup is a code-only change with no migration.
      popupVariable: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      // The earliest moment this popup becomes eligible to show. NULL
      // means not yet eligible (placeholder row written when the user
      // entered the relevant cycle).
      eligibleAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      lastShownAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      dismissCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Set when the user actually completes the popup's action (e.g.
      // submitted Day 7 review, booked the consultation, etc.). Once
      // completed, the popup is permanently retired for that cycle.
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Free-form context the popup needs at render time (e.g. cycle
      // number, plan id, draft pre-fill). Kept small — capped at ~4 KB
      // per row by the controller writers.
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
      },
    },
    {
      tableName: 'PendingPopupStates',
      timestamps: true,
      indexes: [
        // Dashboard read: "give me this user's pending popups."
        { fields: ['userId', 'eligibleAt'] },
        // Idempotency: one (user, variable) row per cycle. The cycle/plan
        // discriminator lives inside `metadata` — when a popup retires
        // (completedAt set), the next cycle creates a new row.
        { fields: ['userId', 'popupVariable', 'completedAt'] },
      ],
    }
  );

  PendingPopupState.associate = (models) => {
    PendingPopupState.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return PendingPopupState;
};
