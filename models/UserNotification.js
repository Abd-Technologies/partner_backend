module.exports = (sequelize, DataTypes) => {
  const UserNotification = sequelize.define("UserNotification", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    type: {
      type: DataTypes.STRING(80),
      allowNull: false,
      defaultValue: "general",
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    data: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    deviceToken: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    deliveryStatus: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "sent",
    },
    errorCode: {
      type: DataTypes.STRING(120),
      allowNull: true,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  UserNotification.associate = (models) => {
    UserNotification.belongsTo(models.User, { foreignKey: "userId" });
  };

  return UserNotification;
};
