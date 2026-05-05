-- ─────────────────────────────────────────────────────────────────────────
-- B2.7 one-time backfill: create a starting WeeklyCheckin row for every
-- existing user who has a parseable `Users.weight` string but no
-- WeeklyCheckin rows yet. Anchors weight-progress math for legacy users.
--
-- Week convention: Monday-start. The backfilled row uses the Monday of the
-- WEEK THE USER SIGNED UP (u.createdAt). This keeps historical accuracy —
-- we don't pretend every legacy user logged their starting weight this week.
--
-- Uses MySQL-specific date math (DAYOFWEEK, INTERVAL). Tested on MySQL 5.7+ /
-- MariaDB. Safe to re-run (the EXISTS clause prevents double-insert).
-- ─────────────────────────────────────────────────────────────────────────

-- Preview: count eligible users BEFORE running the INSERT.
-- SELECT COUNT(*) AS backfill_eligible
-- FROM Users u
-- WHERE u.weight IS NOT NULL
--   AND u.weight != ''
--   AND u.weight REGEXP '^[0-9]+(\\.[0-9]+)?$'
--   AND NOT EXISTS (SELECT 1 FROM WeeklyCheckins wc WHERE wc.userId = u.id);

-- Actual backfill.
INSERT INTO WeeklyCheckins (userId, weekDate, weightKg, createdAt, updatedAt)
SELECT
    u.id,
    -- Monday of the week u.createdAt landed in.
    -- DAYOFWEEK: 1=Sunday, 2=Monday, ..., 7=Saturday
    -- We want: Sunday → -6 days, Monday → 0, Tuesday → -1, ..., Saturday → -5
    -- Offset formula: (DAYOFWEEK(x)=1 ? -6 : 2 - DAYOFWEEK(x))
    DATE(DATE_ADD(
        u.createdAt,
        INTERVAL (CASE WHEN DAYOFWEEK(u.createdAt) = 1 THEN -6 ELSE 2 - DAYOFWEEK(u.createdAt) END) DAY
    )) AS weekDate,
    CAST(u.weight AS DECIMAL(5,2)) AS weightKg,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM Users u
WHERE u.weight IS NOT NULL
  AND u.weight != ''
  AND u.weight REGEXP '^[0-9]+(\\.[0-9]+)?$'
  AND NOT EXISTS (
      SELECT 1 FROM WeeklyCheckins wc WHERE wc.userId = u.id
  );

-- Post-run verification:
-- SELECT COUNT(*) FROM WeeklyCheckins;                           -- should grow by backfill_eligible count
-- SELECT u.id, u.weight, wc.weekDate, wc.weightKg
--   FROM Users u JOIN WeeklyCheckins wc ON wc.userId = u.id
--   ORDER BY u.createdAt DESC LIMIT 20;                          -- spot-check
