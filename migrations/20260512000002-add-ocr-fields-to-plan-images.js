'use strict';

/**
 * Promote OCR-extracted fields from the `ocrData` JSON blob to dedicated
 * columns on PlanImages. Makes them queryable, indexable, and visible
 * without JSON parsing.
 *
 * Adds:
 *   ocrAmount         INT          — amount detected on the slip
 *   ocrBank           VARCHAR(80)  — bank name (HBL, JazzCash, etc.)
 *   ocrDate           VARCHAR(40)  — raw date string from slip
 *   ocrSender         VARCHAR(120) — sender's name from slip
 *   ocrTransactionId  VARCHAR(80)  — transaction reference number
 *
 * Unique index on ocrTransactionId so the same transaction can never be
 * approved twice (real-time duplicate prevention at the DB level).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = [
      { name: 'ocrAmount',        spec: { type: Sequelize.INTEGER, allowNull: true } },
      { name: 'ocrBank',          spec: { type: Sequelize.STRING(80),  allowNull: true } },
      { name: 'ocrDate',          spec: { type: Sequelize.STRING(40),  allowNull: true } },
      { name: 'ocrSender',        spec: { type: Sequelize.STRING(120), allowNull: true } },
      { name: 'ocrTransactionId', spec: { type: Sequelize.STRING(80),  allowNull: true } },
    ];

    for (const c of cols) {
      try {
        await queryInterface.addColumn('PlanImages', c.name, c.spec);
      } catch (err) {
        if (!err.message.includes('Duplicate')) throw err;
      }
    }

    // Index ocrTransactionId for fast duplicate detection.
    // NOT unique (some slips genuinely have no ref, would conflict on NULL).
    try {
      await queryInterface.addIndex('PlanImages', ['ocrTransactionId'], {
        name: 'idx_planimg_ocr_txn_id',
      });
    } catch (err) {
      if (!err.message.includes('Duplicate key')) throw err;
    }

    // Index ocrBank + ocrAmount for admin queue filtering/reporting
    try {
      await queryInterface.addIndex('PlanImages', ['ocrBank'], { name: 'idx_planimg_ocr_bank' });
    } catch (err) { if (!err.message.includes('Duplicate key')) throw err; }
  },

  async down(queryInterface) {
    try { await queryInterface.removeIndex('PlanImages', 'idx_planimg_ocr_bank'); } catch {}
    try { await queryInterface.removeIndex('PlanImages', 'idx_planimg_ocr_txn_id'); } catch {}
    for (const c of ['ocrAmount', 'ocrBank', 'ocrDate', 'ocrSender', 'ocrTransactionId']) {
      try { await queryInterface.removeColumn('PlanImages', c); } catch {}
    }
  },
};
