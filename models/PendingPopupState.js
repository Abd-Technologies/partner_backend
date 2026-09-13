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
      //
      // IMPORTANT — MariaDB compatibility workaround (root cause of the
      // 2026-09-13 metadata corruption incident):
      // This app connects via Sequelize's `mysql` dialect (mysql2 driver)
      // pointed at a MariaDB server (XAMPP). Real MySQL reports a JSON
      // column's protocol type code as JSON, which is what makes
      // Sequelize's automatic read-side `JSON.parse()` fire. MariaDB's
      // JSON type is only a CHECK-constrained alias for LONGTEXT — over
      // the wire it reports as a plain text/blob type, so Sequelize's
      // auto-parse never triggers and `instance.metadata` can silently
      // come back as the raw JSON-encoded STRING instead of an object.
      // Helper code across this codebase does `{ ...recent.metadata }` to
      // merge metadata forward (see helper/popupEligibility.js and
      // controllers/FrontSite/popupStateController.js) — spreading a
      // STRING in JS doesn't throw, it silently produces an object keyed
      // by character index ({"0":"{","1":"\"",...}). Re-stringifying and
      // re-storing that on every dashboard reload compounds explosively
      // (each generation's JSON text is ~7-10x longer than the last),
      // which is exactly what produced a 2.8-million-character value and
      // then an ECONNRESET on the next query against this table.
      //
      // Fix: a custom getter that coerces a string value back into a
      // parsed object (or null) every time, regardless of whether the
      // driver already auto-parsed it. This makes `.metadata` safe to
      // spread everywhere, on both MySQL and MariaDB.
      metadata: {
        type: DataTypes.JSON,
        allowNull: true,
        get() {
          const raw = this.getDataValue('metadata');
          if (typeof raw === 'string') {
            if (raw === '') return null;
            try {
              return JSON.parse(raw);
            } catch (e) {
              console.error(
                '[PendingPopupState] corrupt metadata JSON, id=',
                this.getDataValue('id'),
                e
              );
              return null;
            }
          }
          return raw;
        },
        set(value) {
          this.setDataValue('metadata', value);
        },
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
