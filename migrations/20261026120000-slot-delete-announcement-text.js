'use strict';
// Oct 2026: (1) Slots.deletedAt so the admin can delete a slot (soft delete,
// model is paranoid). (2) Announcements title/body to TEXT (were 255 chars;
// the app allows 500). Idempotent: safe on every start.
function col(desc, name) {
  const k = Object.keys(desc).find((c) => c.toLowerCase() === name.toLowerCase());
  return k ? desc[k] : null;
}
module.exports = {
  async up(queryInterface, Sequelize) {
    const slots = await queryInterface.describeTable('Slots');
    if (!col(slots, 'deletedAt')) {
      await queryInterface.addColumn('Slots', 'deletedAt', { type: Sequelize.DATE, allowNull: true });
    }
    const ann = await queryInterface.describeTable('Announcements');
    for (const name of ['title', 'body']) {
      const c = col(ann, name);
      if (c && !/text/i.test(String(c.type))) {
        await queryInterface.changeColumn('Announcements', name, { type: Sequelize.TEXT, allowNull: true });
      }
    }
  },
  async down() {},
};
