// models/Replay.js
module.exports = (sequelize, DataTypes) => {
  const Replay = sequelize.define('Reply', {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
  });

  Replay.associate = (models) => {
    // Each replay belongs to a user (sender)
    Replay.belongsTo(models.User, {
      foreignKey: 'userId',
      onDelete: 'CASCADE',
    });

    // Each replay belongs to a post (chat group)
    Replay.belongsTo(models.Post, {
      foreignKey: 'postId',
      onDelete: 'CASCADE',
    });
  };

  return Replay;
};
