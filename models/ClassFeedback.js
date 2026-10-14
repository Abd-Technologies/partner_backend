// One rating per user, per class, per day (see fitHer Flows › Class feedback).
//   rating null + skipped true  = she tapped ✕ on the home card.
//   final false                 = she tapped a star, the chips sheet is still open.
module.exports = (sequelize, DataTypes) => {
  const ClassFeedback = sequelize.define(
    "ClassFeedback",
    {
      userId: { type: DataTypes.INTEGER, allowNull: false },
      slotId: { type: DataTypes.INTEGER, allowNull: false },
      trainerId: { type: DataTypes.INTEGER, allowNull: true },
      classDate: { type: DataTypes.DATEONLY, allowNull: false }, // PKT day of the class
      className: { type: DataTypes.STRING(120), allowNull: true },
      rating: { type: DataTypes.INTEGER, allowNull: true },
      tags: { type: DataTypes.TEXT, allowNull: true }, // JSON array of chip labels
      comment: { type: DataTypes.TEXT, allowNull: true },
      skipped: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      final: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      minutesAttended: { type: DataTypes.INTEGER, allowNull: true },
      alertedAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "ClassFeedbacks",
      indexes: [
        { unique: true, fields: ["userId", "slotId", "classDate"] },
        { fields: ["trainerId", "classDate"] },
      ],
    }
  );

  ClassFeedback.associate = (models) => {
    ClassFeedback.belongsTo(models.User, { foreignKey: "userId", as: "client" });
    ClassFeedback.belongsTo(models.User, { foreignKey: "trainerId", as: "trainer" });
    ClassFeedback.belongsTo(models.Slot, { foreignKey: "slotId", as: "slot" });
  };

  ClassFeedback.prototype.tagList = function () {
    try {
      const t = JSON.parse(this.getDataValue("tags") || "[]");
      return Array.isArray(t) ? t : [];
    } catch (_) {
      return [];
    }
  };

  return ClassFeedback;
};
