module.exports = (sequelize, DataTypes) => {
    const ClassAttendance = sequelize.define("ClassAttendance", {
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: false
        },
        slot_id: {
            type: DataTypes.INTEGER, // Optional: track which slot they attended
            allowNull: true
        },
        attended_at: {
            type: DataTypes.DATEONLY, // Stores YYYY-MM-DD
            allowNull: false
        }
    });

    ClassAttendance.associate = (models) => {
        ClassAttendance.belongsTo(models.User, {
            foreignKey: "user_id",
            as: "user"
        });
        // If you have slots
        ClassAttendance.belongsTo(models.Slot, {
            foreignKey: "slot_id",
            as: "slot"
        });
    };

    return ClassAttendance;
};
