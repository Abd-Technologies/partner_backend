module.exports = (sequelize, DataTypes) => {
  const NotificationPreference = sequelize.define('NotificationPreference', {
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
    morningNudge: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    classPrep: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    classStart: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    missedRecovery: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    trainerCancelled: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    weeklyCheckin: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    // "Diet plan updates" switch (Oct 2026). Was only saved on the phone,
    // so diet pushes still came while the app was closed. Column added by
    // migrations/20261031120000-notif-diet-and-hide.js.
    dietUpdates: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    quietStart: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '23:30',
    },
    quietEnd: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '07:00',
    },
    timeBlock: {
      type: DataTypes.ENUM('morning', 'afternoon', 'evening', 'night', 'all'),
      allowNull: false,
      defaultValue: 'all',
    },
  });

  NotificationPreference.associate = (models) => {
    NotificationPreference.belongsTo(models.User, { foreignKey: 'userId' });
  };

  return NotificationPreference;
};
