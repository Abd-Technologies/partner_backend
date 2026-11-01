'use strict';

// Nov 2026: "Why did you leave early?" answer (app, class feedback).
// One of: It felt too hard / It felt too easy / Sound or video trouble /
// Something came up / Something else.
// Idempotent: safe on every start.
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('ClassFeedbacks');
    if (!cols.earlyReason) {
      await queryInterface.addColumn('ClassFeedbacks', 'earlyReason', { type: Sequelize.STRING(40), allowNull: true });
    }
  },
  async down(queryInterface) {
    const cols = await queryInterface.describeTable('ClassFeedbacks');
    if (cols.earlyReason) await queryInterface.removeColumn('ClassFeedbacks', 'earlyReason');
  },
};
