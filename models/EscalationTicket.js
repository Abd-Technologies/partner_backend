module.exports = (sequelize, DataTypes) => {
  // One queue for every escalation in Section 12. Both dietitian and admin
  // are notified on every ticket except SYSTEM_ISSUE which is admin-only.
  // The notification fan-out lives in helper/escalation.js (Phase 1C) so
  // the model stays a dumb store.
  const EscalationTicket = sequelize.define(
    'EscalationTicket',
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
      // Nullable: SYSTEM_ISSUE has no dietitian; INACTIVITY may not have
      // an assigned dietitian for workout-only users.
      dietitianId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      trigger: {
        type: DataTypes.ENUM(
          'PLAN_DELAYED',
          'CONSULT_NO_SHOW',
          'INACTIVITY',
          'MEDICAL',
          'REVIEW_FLAG',
          'BOOKING_REMINDER_5X',
          'SYSTEM_ISSUE'
        ),
        allowNull: false,
      },
      severity: {
        type: DataTypes.ENUM('low', 'medium', 'high'),
        allowNull: false,
        defaultValue: 'medium',
      },
      status: {
        type: DataTypes.ENUM('open', 'acknowledged', 'resolved'),
        allowNull: false,
        defaultValue: 'open',
      },
      // Trigger-specific context (slotId, planId, reviewId, freeText, etc.)
      // Kept as JSON so we don't migrate the schema for every new trigger.
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
      },
      notifiedDietitian: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      notifiedAdmin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      openedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      resolvedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      resolvedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      resolutionNote: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
    },
    {
      tableName: 'EscalationTickets',
      timestamps: true,
      indexes: [
        { fields: ['status'] },
        { fields: ['trigger'] },
        { fields: ['userId'] },
        { fields: ['dietitianId'] },
      ],
    }
  );

  EscalationTicket.associate = (models) => {
    EscalationTicket.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'client',
    });
    EscalationTicket.belongsTo(models.User, {
      foreignKey: 'dietitianId',
      as: 'dietitian',
    });
    EscalationTicket.belongsTo(models.User, {
      foreignKey: 'resolvedBy',
      as: 'resolver',
    });
  };

  return EscalationTicket;
};
