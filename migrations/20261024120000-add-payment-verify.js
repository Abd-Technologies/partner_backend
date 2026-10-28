'use strict';
// Payment check after AI slip approval (Oct 2026): columns on PlanImages.
// Idempotent — safe on every start.
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}
module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.describeTable('PlanImages');
    const cols = [
      ['verifyStatus', { type: Sequelize.STRING(16), allowNull: true }],
      ['verifyUserPlanId', { type: Sequelize.INTEGER, allowNull: true }],
      ['verifyExtended', { type: Sequelize.BOOLEAN, allowNull: true }],
      ['verifyDays', { type: Sequelize.INTEGER, allowNull: true }],
      ['verifyStartedAt', { type: Sequelize.DATE, allowNull: true }],
      ['verifyReminders', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 }],
      ['heldAt', { type: Sequelize.DATE, allowNull: true }],
      ['verifiedAt', { type: Sequelize.DATE, allowNull: true }],
      ['verifiedBy', { type: Sequelize.INTEGER, allowNull: true }],
      ['userProof', { type: Sequelize.STRING(255), allowNull: true }],
    ];
    for (const [name, def] of cols) {
      if (!hasColumn(t, name)) await queryInterface.addColumn('PlanImages', name, def);
    }
  },
  async down() {},
};
