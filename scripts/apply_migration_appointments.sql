-- Migration: add 'In Progress' to Appointment status enum + completed_by
-- + status_changed_at audit columns. Mirrors the trainer Slot pattern
-- (see migrations/20260502192435-add-completed-by-to-slots.js) so the
-- dietitian-side appointment flow has the same manual-vs-cron audit
-- signal trainers already have.
--
-- Run via mysql CLI (more reliable than phpMyAdmin's tab context):
--   mysql -u root testing < partner_backend/scripts/apply_migration_appointments.sql
--
-- Whole thing is one transaction. If anything fails, nothing applies.

START TRANSACTION;

-- 0. Sequelize migration tracking table. CREATE IF NOT EXISTS so this
--    is safe on a DB that's never had sequelize-cli run against it.
CREATE TABLE IF NOT EXISTS SequelizeMeta (
  name VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 1. Extend status enum with 'In Progress' between 'confirmed' and
--    'completed'. Preserves nullable + 'pending' default.
ALTER TABLE appointments
  MODIFY COLUMN status
    ENUM('pending','confirmed','In Progress','completed','canceled','canceledByUser')
    DEFAULT 'pending';

-- 2. Audit columns. NULL on completed_by = the auto-end cron flipped it.
ALTER TABLE appointments
  ADD COLUMN completed_by INT NULL DEFAULT NULL,
  ADD COLUMN status_changed_at DATETIME NULL DEFAULT NULL;

-- 3. Record the migration so future `db:migrate` runs skip it.
INSERT INTO SequelizeMeta (name)
VALUES ('20260503120000-add-completed-by-and-in-progress-to-appointments.js');

COMMIT;

-- Verification (runs after COMMIT, prints to your terminal).
SELECT 'Schema after migration:' AS '';
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'appointments'
ORDER BY ORDINAL_POSITION;

SELECT 'SequelizeMeta entry:' AS '';
SELECT name FROM SequelizeMeta
WHERE name = '20260503120000-add-completed-by-and-in-progress-to-appointments.js';
