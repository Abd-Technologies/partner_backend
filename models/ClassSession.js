// Class diary: ONE row per class per day, never wiped (the Slot row is
// reused every week and reset to "Upcoming" each night). Written by
// helper/classDiary.js from start / end / cancel / auto-cancel / auto-end,
// and counted at the end of the day from ClassPresence.
module.exports = (sequelize, DataTypes) => {
  const ClassSession = sequelize.define(
    "ClassSession",
    {
      slotId: { type: DataTypes.INTEGER, allowNull: false },
      date: { type: DataTypes.DATEONLY, allowNull: false }, // Pakistan date
      trainerId: { type: DataTypes.INTEGER, allowNull: true },
      className: { type: DataTypes.STRING(120), allowNull: true },
      scheduledStart: { type: DataTypes.DATE, allowNull: true },
      scheduledEnd: { type: DataTypes.DATE, allowNull: true },
      // live / completed / cancelled / auto_cancelled
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "upcoming" },
      startedAt: { type: DataTypes.DATE, allowNull: true },
      startedById: { type: DataTypes.INTEGER, allowNull: true },
      startLateMinutes: { type: DataTypes.INTEGER, allowNull: true }, // minus = early
      usedOtherLink: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      endedAt: { type: DataTypes.DATE, allowNull: true },
      endedBy: { type: DataTypes.STRING(10), allowNull: true }, // trainer / admin / system
      endedById: { type: DataTypes.INTEGER, allowNull: true },
      cancelledAt: { type: DataTypes.DATE, allowNull: true },
      cancelledById: { type: DataTypes.INTEGER, allowNull: true },
      cancelReason: { type: DataTypes.STRING(200), allowNull: true }, // trainer's reason (Nov 2026)
      joinedCount: { type: DataTypes.INTEGER, allowNull: true }, // women who joined at all
      attendedCount: { type: DataTypes.INTEGER, allowNull: true }, // in class 10+ min
      avgMinutes: { type: DataTypes.INTEGER, allowNull: true }, // of those who attended
      countedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "ClassSessions",
      indexes: [
        { unique: true, fields: ["slotId", "date"] },
        { fields: ["date"] },
        { fields: ["trainerId", "date"] },
      ],
    }
  );
  ClassSession.associate = (models) => {
    ClassSession.belongsTo(models.User, { foreignKey: "trainerId", as: "trainer" });
    ClassSession.belongsTo(models.Slot, { foreignKey: "slotId", as: "slot" });
  };
  return ClassSession;
};
