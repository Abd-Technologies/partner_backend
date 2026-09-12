'use strict';

// Fixes "Unknown column 'trainerId' in field list" on admin plan
// approval (AdminController.js payment_success sets
// userPlan.trainerId / userPlan.dietitianId, which requires the
// columns to actually exist on UserPlans).
//
// This was masked for a while because models/User.js had the
// association that registers these as real Sequelize attributes
// commented out — so Sequelize silently dropped the assignment
// instead of erroring. Re-enabling that association (already done)
// surfaced the truth: the columns were never added to this
// database's UserPlans table at all.
//
// Guards each addColumn with describeTable so this is safe to run
// even if one of the two columns somehow already exists on a given
// environment.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('UserPlans');

    if (!table.trainerId) {
      await queryInterface.addColumn('UserPlans', 'trainerId', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }

    if (!table.dietitianId) {
      await queryInterface.addColumn('UserPlans', 'dietitianId', {
        type: Sequelize.INTEGER,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('UserPlans');
    if (table.dietitianId) {
      await queryInterface.removeColumn('UserPlans', 'dietitianId');
    }
    if (table.trainerId) {
      await queryInterface.removeColumn('UserPlans', 'trainerId');
    }
  },
};
