module.exports = (sequelize, DataTypes) => {
  // A user's "Report an issue" ticket. Admin (userType "Admin") and the CRM
  // can both reply and change the status. Every message in the thread lives
  // in SupportTicketMessage.
  const SupportTicket = sequelize.define(
    'SupportTicket',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      userId: { type: DataTypes.INTEGER, allowNull: false },
      // APP_ISSUE | CLASS | PAYMENT | PLAN | ACCOUNT | OTHER | MEDICAL
      category: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'OTHER' },
      message: { type: DataTypes.TEXT, allowNull: true },
      imageUrl: { type: DataTypes.STRING(512), allowNull: true },
      status: {
        type: DataTypes.ENUM('received', 'in_review', 'resolved'),
        allowNull: false,
        defaultValue: 'received',
      },
      // Creation date + 3 working days (weekends skipped).
      dueAt: { type: DataTypes.DATE, allowNull: true },
      resolvedAt: { type: DataTypes.DATE, allowNull: true },
      lastActivityAt: { type: DataTypes.DATE, allowNull: true },
      // true = the user has a staff reply she hasn't opened yet.
      userUnread: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      // true = the user wrote something staff hasn't opened yet.
      adminUnread: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      // "Did this solve your issue?" answer: solved | not_solved
      feedback: { type: DataTypes.STRING(16), allowNull: true },
      // Who last handled it (admin user id), null when it came from the CRM.
      handledBy: { type: DataTypes.INTEGER, allowNull: true },
      crmSynced: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'SupportTickets',
      indexes: [{ fields: ['userId'] }, { fields: ['status'] }],
    }
  );

  SupportTicket.associate = (models) => {
    SupportTicket.belongsTo(models.User, { foreignKey: 'userId', as: 'client', constraints: false });
    SupportTicket.hasMany(models.SupportTicketMessage, {
      foreignKey: 'ticketId',
      as: 'messages',
      constraints: false,
    });
  };

  return SupportTicket;
};
