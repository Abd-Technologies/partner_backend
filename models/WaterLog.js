module.exports = (sequelize, DataTypes) => {
  const WaterLog = sequelize.define(
    "WaterLog",
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
      date: {
        // Local date this log belongs to, format YYYY-MM-DD. DATEONLY so a
        // day-bucket aggregation query stays index-friendly.
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      amountMl: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      tableName: "WaterLogs",
      timestamps: true,
      indexes: [
        {
          // Aggregate lookup is always "today's water for user X".
          fields: ["userId", "date"],
        },
      ],
    }
  );

  WaterLog.associate = (models) => {
    WaterLog.belongsTo(models.User, { foreignKey: "userId" });
    models.User.hasMany(WaterLog, { foreignKey: "userId" });
  };

  return WaterLog;
};
