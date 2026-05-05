-- Migration: drop dead `isAvailble` column from SlotDiets.
-- See migrations/20260503130000-drop-isAvailble-from-slotdiets.js for
-- full rationale (typo column, wrong default syntax, never used).
--
-- Run from phpMyAdmin SQL tab (any active DB — fully qualified):

-- 1. Drop the column.
ALTER TABLE testing.SlotDiets DROP COLUMN isAvailble;

-- 2. Track the migration so future `db:migrate` runs skip it.
INSERT INTO testing.SequelizeMeta (name)
VALUES ('20260503130000-drop-isAvailble-from-slotdiets.js');
