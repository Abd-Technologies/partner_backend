'use strict';

// Nov 2026: optional email on a payment link (MagicPaymentLinks.email).
// A WhatsApp payment made before she has an app account is matched to her at
// signup by the link's phone OR this email (helper/paymentClaims.js).
// Idempotent; run on every start from app.js.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'MagicPaymentLinks';
    let cols;
    try { cols = await queryInterface.describeTable(table); } catch (_) { return; }
    if (!cols.email) {
      await queryInterface.addColumn(table, 'email', { type: Sequelize.STRING(160), allowNull: true });
    }
  },
  async down(queryInterface) {
    try { await queryInterface.removeColumn('MagicPaymentLinks', 'email'); } catch (_) { /* already gone */ }
  },
};
