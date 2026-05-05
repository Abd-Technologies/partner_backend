'use strict';

// Per-consultation review table. Lets the admin dashboard aggregate
// rating + comment across all consultations for a dietitian, and
// shows which specific Appointments scored well or poorly.
//
// Constraints:
//   • rating 1-5 enforced in the controller (MySQL pre-8.0 CHECK is
//     a parser-level no-op, so the validation lives in code where
//     it actually fires)
//   • appointmentId UNIQUE — one review per consultation
//   • appointmentId + userId nullable to keep the column type flexible
//     in case a row is created before the FK is wired (sequelize
//     associations don't enforce NOT NULL by default)
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AppointmentReviews', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      rating: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      comment: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
      },
      appointmentId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
    });

    await queryInterface.addIndex('AppointmentReviews', ['appointmentId'], {
      unique: true,
      name: 'appointment_reviews_appointment_id_unique',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('AppointmentReviews');
  },
};
