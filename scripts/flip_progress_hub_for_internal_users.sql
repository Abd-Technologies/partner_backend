-- Phase E1 — Internal QA flag-flip for the new Progress hub.
--
-- Flips `Users.useNewProgressHub` to TRUE for the 5 internal test
-- accounts. Idempotent: safe to re-run; subsequent runs are no-ops.
-- Reversible: see the rollback section at the bottom.
--
-- Usage (staging only, never prod):
--
--   1. Edit the email list below to match the actual internal users in
--      this environment. Default placeholders are intentionally fake so
--      a copy-paste run on prod is a no-op.
--
--   2. Wrap in a transaction so a typo doesn't half-apply:
--
--        mysql -h <staging-host> -u <user> -p <db> \
--          < partner_backend/scripts/flip_progress_hub_for_internal_users.sql
--
--   3. Verify the SELECT at the bottom returns the 5 expected rows
--      with useNewProgressHub = 1.
--
--   4. Have each internal tester force-quit the app and log in fresh —
--      the flag is read from `accessToken` payload at login time and
--      cached in shared_preferences.
--
-- DO NOT run on production. The script is idempotent and reversible
-- but the rollout decision for non-internal users is product-side.

-- ───────────────────────────────────────────────────────────────────────
-- 1. Sanity check: confirm column exists. If the row count is 0, the
-- column hasn't been migrated yet — abort and run the migration first.
-- ───────────────────────────────────────────────────────────────────────
SELECT COUNT(*) AS column_present
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name   = 'Users'
  AND column_name  = 'useNewProgressHub';

-- ───────────────────────────────────────────────────────────────────────
-- 2. Snapshot current state for rollback. Saves to a one-off table named
-- after the run timestamp so concurrent runs don't collide.
-- ───────────────────────────────────────────────────────────────────────
SET @snapshot_name := CONCAT('progress_hub_flip_snapshot_', DATE_FORMAT(NOW(), '%Y%m%d_%H%i%s'));
SET @sql := CONCAT(
  'CREATE TABLE IF NOT EXISTS ', @snapshot_name,
  ' (id INT PRIMARY KEY, email VARCHAR(255), prev_value TINYINT(1), snapshot_at DATETIME)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Replace these with the actual staging emails before running.
SET @internal_emails = JSON_ARRAY(
  'qa1@fither.staging',
  'qa2@fither.staging',
  'qa3@fither.staging',
  'qa4@fither.staging',
  'qa5@fither.staging'
);

-- Snapshot the rows we're about to flip.
SET @sql := CONCAT(
  'INSERT INTO ', @snapshot_name, ' (id, email, prev_value, snapshot_at) ',
  'SELECT id, email, useNewProgressHub, NOW() FROM Users ',
  'WHERE email IN (',
    'JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, "$[0]")),',
    'JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, "$[1]")),',
    'JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, "$[2]")),',
    'JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, "$[3]")),',
    'JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, "$[4]"))',
  ')'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ───────────────────────────────────────────────────────────────────────
-- 3. Flip the flag for the 5 internal users.
-- ───────────────────────────────────────────────────────────────────────
UPDATE Users
SET useNewProgressHub = 1
WHERE email IN (
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[0]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[1]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[2]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[3]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[4]'))
);

-- ───────────────────────────────────────────────────────────────────────
-- 4. Verification queries — paste into the QA report.
-- ───────────────────────────────────────────────────────────────────────

-- 4a. The 5 should now show useNewProgressHub = 1
SELECT id, email, useNewProgressHub, updatedAt
FROM Users
WHERE email IN (
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[0]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[1]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[2]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[3]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[4]'))
)
ORDER BY id;

-- 4b. Spot-check a few non-internal users — should still show 0 (V1).
SELECT id, email, useNewProgressHub
FROM Users
WHERE email NOT IN (
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[0]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[1]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[2]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[3]')),
  JSON_UNQUOTE(JSON_EXTRACT(@internal_emails, '$[4]'))
)
  AND useNewProgressHub = 1;
-- Expected row count: 0 (no other user should have the flag set yet).

-- 4c. Aggregate sanity — exactly 5 users with the flag set.
SELECT COUNT(*) AS total_with_flag_set
FROM Users
WHERE useNewProgressHub = 1;
-- Expected: 5 (or more if a previous beta run already flipped some users —
-- in which case 4a's row count is the canonical verification number).

-- ───────────────────────────────────────────────────────────────────────
-- 5. Rollback — UNCOMMENT and run if the QA pass turns up a regression.
-- Restores the snapshot saved in step 2.
-- ───────────────────────────────────────────────────────────────────────
-- SET @snapshot_name := '<paste the snapshot table name from step 2>';
-- SET @sql := CONCAT(
--   'UPDATE Users u JOIN ', @snapshot_name, ' s ON u.id = s.id ',
--   'SET u.useNewProgressHub = s.prev_value'
-- );
-- PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ───────────────────────────────────────────────────────────────────────
-- 6. Cleanup — drop snapshot table after the QA window closes (≥ 7 days
-- post-flip recommended). UNCOMMENT to run.
-- ───────────────────────────────────────────────────────────────────────
-- SET @sql := CONCAT('DROP TABLE IF EXISTS ', @snapshot_name);
-- PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
