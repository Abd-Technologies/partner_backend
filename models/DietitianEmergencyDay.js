// A dietitian's "Emergency: cancel my day" (Oct 2026). See helper/emergencyDay.js.
// status: scheduled (2-min undo window) | awaiting_approval (3rd+ this
// month, admin decides) | applied | undone | rejected
module.exports = (sequelize, DataTypes) => {
  const DietitianEmergencyDay = sequelize.define(
    'DietitianEmergencyDay',
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      dietitianId: { type: DataTypes.INTEGER, allowNull: false },
      day: { type: DataTypes.DATEONLY, allowNull: false },
      reason: { type: DataTypes.STRING(32), allowNull: false },
      note: { type: DataTypes.STRING(255), allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'scheduled' },
      applyAt: { type: DataTypes.DATE, allowNull: true },
      appliedAt: { type: DataTypes.DATE, allowNull: true },
      decidedBy: { type: DataTypes.INTEGER, allowNull: true },
      sessionsCancelled: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      daysGiven: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'DietitianEmergencyDays',
      timestamps: true,
      indexes: [{ fields: ['dietitianId', 'day'] }, { fields: ['status'] }],
    }
  );
  return DietitianEmergencyDay;
};
