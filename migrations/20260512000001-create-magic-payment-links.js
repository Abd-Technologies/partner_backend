'use strict';

/**
 * Magic payment links — sales reps generate a single shareable link with
 * the plan, duration, paid amount, and discount pre-filled. The customer
 * (or anyone paying on their behalf) clicks the link, lands on the app's
 * upload screen, attaches a payment slip, and submits. Admin reviews and
 * approves.
 *
 * Also extends PlanImages with the richer fields needed to support
 * discounts, rep attribution, and payer relationship.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. MagicPaymentLinks — the link generation registry
    await queryInterface.createTable('MagicPaymentLinks', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      // Short opaque URL token (e.g. "K7M3QR2x9"). Goes into the shareable URL.
      token: {
        type: Sequelize.STRING(64),
        allowNull: false,
        unique: true,
      },
      // Plan + duration the customer is paying for
      PlanId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Plans', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      PriceDurationId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'PriceDurations', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      // Linked Customer in app (populated when user logs in / signs up)
      UserId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      // Pre-link identification (rep knows the phone number from WhatsApp conversation)
      phone: {
        type: Sequelize.STRING(32),
        allowNull: true,
      },
      // CRM-side lead id (cross-system reference, for tracking which lead converted)
      crmLeadId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      // Pricing breakdown
      listPrice: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Plan sticker price in PKR',
      },
      paidAmount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        comment: 'Amount the customer is expected to pay',
      },
      discountAmount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'listPrice - paidAmount',
      },
      discountReason: {
        type: Sequelize.STRING(120),
        allowNull: true,
        comment: 'e.g. winback_30off_q2_2026, rep_courtesy, hardship_case',
      },
      // Rep attribution
      createdByRepId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'Users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'partner_backend.users.id of the sales rep who created the link',
      },
      // Optional payer info pre-filled by rep
      payerName: {
        type: Sequelize.STRING(120),
        allowNull: true,
      },
      payerRelationship: {
        type: Sequelize.STRING(40),
        allowNull: true,
        comment: 'self / husband / father / brother / sister / mother / friend / coach / other',
      },
      // Lifecycle
      status: {
        type: Sequelize.ENUM('pending', 'opened', 'redeemed', 'expired', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      expiresAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      openedAt: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'First time the link was opened (for analytics)',
      },
      redeemedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      redeemedPlanImageId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'PlanImages', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
        comment: 'The PlanImage created when this link was redeemed',
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Indexes for common lookups
    await queryInterface.addIndex('MagicPaymentLinks', ['token'], { unique: true, name: 'idx_mpl_token' });
    await queryInterface.addIndex('MagicPaymentLinks', ['status']);
    await queryInterface.addIndex('MagicPaymentLinks', ['createdByRepId']);
    await queryInterface.addIndex('MagicPaymentLinks', ['phone']);
    await queryInterface.addIndex('MagicPaymentLinks', ['crmLeadId']);

    // 2. Extend PlanImages with richer fields
    const planImageCols = [
      { name: 'listPrice',          spec: { type: Sequelize.INTEGER, allowNull: true } },
      { name: 'paidAmount',         spec: { type: Sequelize.INTEGER, allowNull: true } },
      { name: 'discountAmount',     spec: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 } },
      { name: 'discountReason',     spec: { type: Sequelize.STRING(120), allowNull: true } },
      { name: 'uploadedByRepId',    spec: { type: Sequelize.INTEGER, allowNull: true } },
      { name: 'uploadSource',       spec: { type: Sequelize.ENUM('user_app', 'rep_crm', 'magic_link'), allowNull: false, defaultValue: 'user_app' } },
      { name: 'magicPaymentLinkId', spec: { type: Sequelize.INTEGER, allowNull: true } },
      { name: 'payerName',          spec: { type: Sequelize.STRING(120), allowNull: true } },
      { name: 'payerRelationship',  spec: { type: Sequelize.STRING(40), allowNull: true } },
      { name: 'ocrData',            spec: { type: Sequelize.JSON, allowNull: true } },
      { name: 'ocrConfidence',      spec: { type: Sequelize.DECIMAL(4, 3), allowNull: true } },
    ];

    for (const col of planImageCols) {
      try {
        await queryInterface.addColumn('PlanImages', col.name, col.spec);
      } catch (err) {
        // Column may already exist on re-run — log and continue
        if (!err.message.includes('Duplicate')) throw err;
      }
    }
  },

  async down(queryInterface, Sequelize) {
    // Reverse order: drop PlanImages columns, then table
    const cols = [
      'listPrice', 'paidAmount', 'discountAmount', 'discountReason',
      'uploadedByRepId', 'uploadSource', 'magicPaymentLinkId',
      'payerName', 'payerRelationship', 'ocrData', 'ocrConfidence',
    ];
    for (const c of cols) {
      try { await queryInterface.removeColumn('PlanImages', c); } catch { /* ignore */ }
    }
    await queryInterface.dropTable('MagicPaymentLinks');
  },
};
