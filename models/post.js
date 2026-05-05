module.exports = (sequelize, DataTypes) => {
  const Post = sequelize.define('Post', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    imageUrl: { type: DataTypes.STRING, allowNull: true },
    text: { type: DataTypes.TEXT, allowNull: true },
    isPost: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    approved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  });

  Post.associate = (models) => {
    Post.belongsTo(models.User, { foreignKey: 'userId' });

    // Correct foreign key naming to prevent duplicates
    Post.hasMany(models.Reply, { foreignKey: 'postId', as: 'messages', onDelete: 'CASCADE' });
    Post.hasMany(models.Like, { foreignKey: 'postId', as: 'likes', onDelete: 'CASCADE' });
  };

  return Post;
};
