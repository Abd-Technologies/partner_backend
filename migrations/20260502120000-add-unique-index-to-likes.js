'use strict';

// Community feature — prevent duplicate likes via a DB-level unique index
// on (postId, userId). Pairs with findOrCreate in postsController.toggleLike;
// the index is the actual race-condition guarantee.
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('Likes', ['postId', 'userId'], {
      unique: true,
      name: 'likes_post_user_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Likes', 'likes_post_user_unique');
  },
};
