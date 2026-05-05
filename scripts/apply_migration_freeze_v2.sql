-- Migration: add freeze-v2 columns to UserPlans for the user-button
-- freeze flow. See migrations/20260505100000-add-freeze-v2-to-user-plans.js
-- and docs/Freeze_Logic_Audit.md.
--
-- Legacy User.freeze / freezingDays / usedFreezeOption columns and
-- POST /admin/freeze are intentionally NOT touched — they keep working
-- as-is. New endpoints write only the columns added below.
--
-- Run from phpMyAdmin SQL tab (fully qualified):

ALTER TABLE testing.UserPlans
  ADD COLUMN frozenAt DATETIME NULL DEFAULT NULL,
  ADD COLUMN freezeDays INT NULL DEFAULT NULL,
  ADD COLUMN totalFrozenDays INT NOT NULL DEFAULT 0,
  ADD COLUMN originalDurationDays INT NULL DEFAULT NULL,
  ADD COLUMN lastUnfrozenAt DATETIME NULL DEFAULT NULL,
  ADD COLUMN frozenBy INT NULL DEFAULT NULL,
  ADD COLUMN unfrozenBy INT NULL DEFAULT NULL;

INSERT INTO testing.SequelizeMeta (name)
VALUES ('20260505100000-add-freeze-v2-to-user-plans.js');
