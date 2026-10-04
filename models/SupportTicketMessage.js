module.exports = (sequelize, DataTypes) => {
  // One message in a support ticket thread.
  // sender: user (the client) | admin (Admin panel) | crm (CRM agent)
  const SupportTicketMessage = sequelize.define(
    'SupportTicketMessage',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      sender: {
        type: DataTypes.ENUM('user', 'admin', 'crm'),
        allowNull: false,
      },
      senderId: { type: DataTypes.INTEGER, allowNull: true },
      senderName: { type: DataTypes.STRING(120), allowNull: true },
      body: { type: DataTypes.TEXT, allowNull: true },
      imageUrl: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      tableName: 'SupportTicketMessages',
      indexes: [{ fields: ['ticketId'] }],
    }
  );

  SupportTicketMessage.associate = (models) => {
    SupportTicketMessage.belongsTo(models.SupportTicket, {
      foreignKey: 'ticketId',
      constraints: false,
    });
  };

  return SupportTicketMessage;
};
