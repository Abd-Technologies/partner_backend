-- Migration: create AppointmentReviews table for per-consultation
-- ratings + comments. See migrations/20260503140000-create-appointment-reviews.js
-- for the Sequelize migration. This raw-SQL twin is for manual run via
-- phpMyAdmin since the project's sequelize-cli config doesn't have a
-- usable env block (config.json points all envs at localhost/testing).

CREATE TABLE IF NOT EXISTS testing.AppointmentReviews (
  id INT NOT NULL AUTO_INCREMENT,
  rating INT NOT NULL,
  comment LONGTEXT NULL,
  appointmentId INT NULL,
  userId INT NULL,
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY appointment_reviews_appointment_id_unique (appointmentId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO testing.SequelizeMeta (name)
VALUES ('20260503140000-create-appointment-reviews.js');
