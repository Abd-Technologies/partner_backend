-- ═══════════════════════════════════════════════════════════════════════════
-- Seed Progress hub QA data for user 181 — ONE REALISTIC WEEK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Purpose: populate exactly 7 days of realistic activity for user 181 so
-- the Progress hub's "Week" period chip shows a first-week report. This
-- supersedes the prior 30-day seed entirely.
--
-- Run with:
--   mysql -u <user> -p <db> < partner_backend/scripts/seed_user_181_progress_test.sql
--
-- Idempotent: safe to re-run.
--   • DailyCheckins / WeeklyCheckins / WaterLogs / ClassAttendances:
--     guarded by unique indexes (userId+date) where present, NOT EXISTS
--     otherwise.
--   • Goals: only inserts if no `status='active'` row exists.
--   • UserCycleData: model has unique on userId; INSERT IGNORE skips
--     re-runs without overwriting.
--
-- Reversible: the ROLLBACK SECTION at the bottom (commented out) targets
-- the rows this script created. DailyCheckins use a row-precise marker
-- (`note = 'SEED-USER181-WEEK1'`); other tables fall back to a 7-day
-- window for user 181, documented inline.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CONSTRAINT DEVIATIONS — read before running
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. ClassAttendance has only `user_id`, `slot_id`, `attended_at`. The
--    model carries no `kcalBurnt` / `durationMin` / `feeling` /
--    `ratingStars` / `status` / `classId` columns. The seed inserts only
--    the 3 real columns. The hub's stat tile is "Energy avg" precisely
--    because kcal isn't tracked — this isn't a workaround, it's the
--    documented Phase B contract.
--
-- 2. SymptomDelta requires ≥5 datapoints in BOTH the current AND the
--    previous period. The seed populates only the past 7 days (one week,
--    one period). The previous period (last week) has 0 seed rows, so
--    `previous_period.length < 5` → all 4 symptom rows return
--    `notEnoughData: true` → symptoms card shows the empty-state copy
--    "Complete 5 check-ins to see your trends". This is by design for a
--    first-week QA pass and is documented in the expected-state block
--    at the bottom of this file.
--
-- 3. DailyCheckin.date is STRING (not DATEONLY). Stored as 'YYYY-MM-DD'
--    per existing convention.
--
-- 4. ClassAttendance.user_id is the only snake_case foreign key in the
--    schema; every other table uses camelCase userId. Honoured below.
--
-- 5. WaterLogs has NO unique index on (userId, date) — multiple rows
--    per day are valid. Idempotency uses NOT EXISTS guards.
--
-- 6. Streak nuance (Phase B implementation detail): the streak computed
--    by ProgressBuilders.streakDaysAsOf is anchored to `period.endMs`
--    rather than today. With period=Week, `endMs` is the upcoming
--    Sunday at UTC midnight. If you run this seed AND view the hub
--    on any day other than Sunday, the displayed streak may read 0
--    instead of 5 because the algorithm's cursor starts in the
--    future. The 5 attendances are correctly seeded (verifiable via
--    the audit) — this is a controller behaviour, not a seed problem.
--
-- ═══════════════════════════════════════════════════════════════════════════

START TRANSACTION;

-- ───────────────────────────────────────────────────────────────────────
-- 0. Pre-flight: confirm user 181 exists
-- ───────────────────────────────────────────────────────────────────────

SELECT id, status, useNewProgressHub
FROM Users WHERE id = 181;
-- If 0 rows the rest of the script is a no-op (FK constraints reject).
-- Verify the row exists before running.


-- ───────────────────────────────────────────────────────────────────────
-- A. Users — flip status to paid so the bottom-nav routes to V2
-- ───────────────────────────────────────────────────────────────────────
-- ProgressScreenV2 is paid-gated via authController.logInUser?.status.
-- A free user (status=0/false) lands on the legacy V1 screen and never
-- sees the seeded data.

UPDATE Users SET status = 1 WHERE id = 181;


-- ───────────────────────────────────────────────────────────────────────
-- B. Goal — one active long-term goal, idempotent on (userId, status)
-- ───────────────────────────────────────────────────────────────────────
-- 70.0 → 65.0 over ~9 weeks (varies with today's date). expectedPace
-- is computed inline so re-runs against different "today"s produce a
-- consistent goal definition without manual recalculation.

INSERT INTO Goals (
  userId, type, startValueKg, targetValueKg, currentValueKg,
  startDate, targetDate, weeklyClassTarget, expectedPaceKgPerWeek,
  status, createdAt, updatedAt
)
SELECT
  181, 'weight_loss', 70.0, 65.0, 69.4,
  DATE_SUB(CURDATE(), INTERVAL 7 DAY),
  DATE('2026-06-30'),
  5,
  -- (target - start) / weeks. weeks_between(7d ago, 2026-06-30)
  -- = DATEDIFF / 7. Cast to FLOAT division.
  (65.0 - 70.0) / (DATEDIFF(DATE('2026-06-30'),
                             DATE_SUB(CURDATE(), INTERVAL 7 DAY)) / 7.0),
  'active', NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM Goals WHERE userId = 181 AND status = 'active'
);


-- ───────────────────────────────────────────────────────────────────────
-- C. WeeklyCheckin — 2 rows: last week's Monday + this week's Monday
-- ───────────────────────────────────────────────────────────────────────
-- Monday-start convention matches the existing save_weight_log handler.
-- This week's Monday: CURDATE() - WEEKDAY(CURDATE()) days.
-- Last week's Monday: this week - 7 days.
-- Idempotent via the (userId, weekDate) unique index.

INSERT IGNORE INTO WeeklyCheckins
  (userId, weekDate, weightKg, createdAt, updatedAt)
VALUES
  -- Last week (oldest of the two)
  (181,
   DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE()) + 7) DAY), '%Y-%m-%d'),
   70.0, NOW(), NOW()),
  -- This week
  (181,
   DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL  WEEKDAY(CURDATE())      DAY), '%Y-%m-%d'),
   69.4, NOW(), NOW());


-- ───────────────────────────────────────────────────────────────────────
-- D. UserCycleData — set so phase tints work
-- ───────────────────────────────────────────────────────────────────────
-- lastPeriodDate = 7 days ago. With averageCycleLength=28, today is
-- cycleDay 8 (follicular per CyclePhaseCalculator's 18%/46%/57% cuts:
-- menstrualEnd=5, follicularEnd=13, ovulatoryEnd=16, else luteal).
-- Note: dataProvided is INTEGER (model line 42-46), so 1 not true.
-- isRegular is STRING (line 22-25), so 'yes' not true.
-- Inserted BEFORE DailyCheckin so the cycleDay/cyclePhase derivations
-- below have a consistent reference.

INSERT IGNORE INTO UserCycleData (
  userId, lastPeriodDate, averageCycleLength,
  isRegular, periodDuration, flowType,
  currentCycleDay, currentPhase, dataProvided,
  createdAt, updatedAt
) VALUES (
  181,
  DATE_SUB(CURDATE(), INTERVAL 7 DAY),
  28,
  'yes', '5', 'medium',
  8, 'follicular', 1,
  NOW(), NOW()
);


-- ───────────────────────────────────────────────────────────────────────
-- E. DailyCheckin — 6 days, deterministic per-day values
-- ───────────────────────────────────────────────────────────────────────
-- Day-offset → label mapping (the user spec uses inverted "Day -N"
-- labels where Day -1 = today; this script translates to natural
-- offsets from CURDATE for SQL clarity):
--
--   offset 0  = today          (user's "Day -1")
--   offset 1  = yesterday      (user's "Day -2")  — SKIPPED
--   offset 2  = 2 days ago     (user's "Day -3")
--   offset 3  = 3 days ago     (user's "Day -4")
--   offset 4  = 4 days ago     (user's "Day -5")
--   offset 5  = 5 days ago     (user's "Day -6")
--   offset 6  = 6 days ago     (user's "Day -7", oldest)
--
-- cycleDay derivation: lastPeriodDate is 7 days ago (cycleDay 1).
-- offset N from today → cycleDay (8 - N), e.g. offset 0 → cycleDay 8.
-- cyclePhase from CyclePhaseCalculator cuts (28-day cycle):
--   cycleDay 1-5  → menstrual
--   cycleDay 6-13 → follicular   (today is here)
--   cycleDay 14-16→ ovulatory
--   else          → luteal
--
-- Avg across 6 days (per user spec):
--   energy = (7+7+8+8+6+8)/6 ≈ 7.33  → hero "Energy 7.3"
--   mood   = (7+8+7+8+6+8)/6 ≈ 7.33
--   sleep  = (7.0+6.5+7.0+6.8+6.5+7.5)/6 ≈ 6.88h → hero "Sleep 6.9h"
--
-- Marker: note='SEED-USER181-WEEK1' on every row for the rollback.
-- Idempotent via the (userId, date) unique index.

INSERT IGNORE INTO DailyCheckins (
  userId, date,
  energyLevel, moodLevel, sleepHours,
  bloatingSeverity, crampSeverity, sleepQuality,
  cycleDay, cyclePhase,
  note,
  createdAt, updatedAt
) VALUES
  -- offset 6 (oldest in the 7-day window, cycleDay 2 → menstrual)
  (181, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 6 DAY), '%Y-%m-%d'),
   7, 7, 7.0, 4, 2, 7,
   2, 'menstrual',
   'SEED-USER181-WEEK1', NOW(), NOW()),
  -- offset 5 (cycleDay 3 → menstrual)
  (181, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '%Y-%m-%d'),
   7, 8, 6.5, 3, 1, 6,
   3, 'menstrual',
   'SEED-USER181-WEEK1', NOW(), NOW()),
  -- offset 4 (cycleDay 4 → menstrual)
  (181, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '%Y-%m-%d'),
   8, 7, 7.0, 3, 0, 7,
   4, 'menstrual',
   'SEED-USER181-WEEK1', NOW(), NOW()),
  -- offset 3 (cycleDay 5 → menstrual, last menstrual day)
  (181, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '%Y-%m-%d'),
   8, 8, 6.8, 2, 0, 8,
   5, 'menstrual',
   'SEED-USER181-WEEK1', NOW(), NOW()),
  -- offset 2 (cycleDay 6 → follicular begins)
  (181, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '%Y-%m-%d'),
   6, 6, 6.5, 4, 1, 6,
   6, 'follicular',
   'SEED-USER181-WEEK1', NOW(), NOW()),
  -- offset 1 (yesterday) — SKIPPED, no row inserted
  -- offset 0 (today, cycleDay 8 → follicular)
  (181, DATE_FORMAT(CURDATE(), '%Y-%m-%d'),
   8, 8, 7.5, 2, 0, 8,
   8, 'follicular',
   'SEED-USER181-WEEK1', NOW(), NOW());


-- ───────────────────────────────────────────────────────────────────────
-- F. ClassAttendance — 5 attended classes on the 5 most recent days
-- ───────────────────────────────────────────────────────────────────────
-- Days: today, yesterday, 2-, 3-, 4-days-ago = 5 consecutive days.
-- Forms a 5-day streak ending today; matches weeklyClassTarget=5 →
-- the Classes ring lands at 5/5 = 100% on the glance card.
-- Schema columns: user_id (snake), slot_id, attended_at. Nothing else.
-- NOT EXISTS guard keeps re-runs idempotent.

INSERT INTO ClassAttendances (user_id, slot_id, attended_at, createdAt, updatedAt)
SELECT 181, NULL, target_date, NOW(), NOW()
FROM (
  SELECT CURDATE()                                     AS target_date UNION ALL
  SELECT DATE_SUB(CURDATE(), INTERVAL 1 DAY)                          UNION ALL
  SELECT DATE_SUB(CURDATE(), INTERVAL 2 DAY)                          UNION ALL
  SELECT DATE_SUB(CURDATE(), INTERVAL 3 DAY)                          UNION ALL
  SELECT DATE_SUB(CURDATE(), INTERVAL 4 DAY)
) AS d
WHERE NOT EXISTS (
  SELECT 1 FROM ClassAttendances ca
  WHERE ca.user_id = 181 AND ca.attended_at = d.target_date
);


-- ───────────────────────────────────────────────────────────────────────
-- G. WaterLog — 5 days of water (skip days 3 and 1 = "Day -4" and "Day -2")
-- ───────────────────────────────────────────────────────────────────────
-- Per-day values from the user spec:
--   offset 6 ("Day -7"): 1700 mL
--   offset 5 ("Day -6"): 1600 mL
--   offset 4 ("Day -5"): 1750 mL
--   offset 3 ("Day -4"): SKIPPED
--   offset 2 ("Day -3"): 1650 mL
--   offset 1 ("Day -2"): SKIPPED
--   offset 0 (today):    1800 mL
-- Average across 5 days = 1700 mL = 1.7L → 68% of 2.5L target → amber
-- "drink more" state (below the 70% threshold).
-- WaterLogs has no (userId,date) unique index → NOT EXISTS guard.

INSERT INTO WaterLogs (userId, date, amountMl, createdAt, updatedAt)
SELECT 181, target_date, ml, NOW(), NOW()
FROM (
  SELECT DATE_SUB(CURDATE(), INTERVAL 6 DAY) AS target_date, 1700 AS ml UNION ALL
  SELECT DATE_SUB(CURDATE(), INTERVAL 5 DAY),                1600       UNION ALL
  SELECT DATE_SUB(CURDATE(), INTERVAL 4 DAY),                1750       UNION ALL
  SELECT DATE_SUB(CURDATE(), INTERVAL 2 DAY),                1650       UNION ALL
  SELECT CURDATE(),                                          1800
) AS w
WHERE NOT EXISTS (
  SELECT 1 FROM WaterLogs wl
  WHERE wl.userId = 181 AND wl.date = w.target_date
);


COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- POST-SEED VERIFICATION — re-runs the audit so you can confirm the seed
-- ═══════════════════════════════════════════════════════════════════════════

SELECT '— Users.status (must be 1 for V2 routing) —' AS section;
SELECT id, status, useNewProgressHub FROM Users WHERE id = 181;

SELECT '— Goal block —' AS section;
SELECT id, type, startValueKg, targetValueKg, currentValueKg,
       startDate, targetDate, weeklyClassTarget,
       ROUND(expectedPaceKgPerWeek, 3) AS expectedPaceKgPerWeek,
       status
FROM Goals WHERE userId = 181 AND status = 'active';

SELECT '— WeeklyCheckin block (expect 2 rows in past 14 days) —' AS section;
SELECT COUNT(*) AS rows_total, MIN(weekDate) AS earliest, MAX(weekDate) AS latest
FROM WeeklyCheckins
WHERE userId = 181
  AND weekDate >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 14 DAY), '%Y-%m-%d');

SELECT '— DailyCheckin block (expect 6 SEED-USER181-WEEK1 rows) —' AS section;
SELECT COUNT(*) AS rows_total,
       SUM(CASE WHEN bloatingSeverity IS NOT NULL THEN 1 ELSE 0 END) AS bloating_filled,
       SUM(CASE WHEN crampSeverity    IS NOT NULL THEN 1 ELSE 0 END) AS cramp_filled,
       SUM(CASE WHEN energyLevel      IS NOT NULL THEN 1 ELSE 0 END) AS energy_filled,
       SUM(CASE WHEN moodLevel        IS NOT NULL THEN 1 ELSE 0 END) AS mood_filled,
       SUM(CASE WHEN sleepHours       IS NOT NULL THEN 1 ELSE 0 END) AS sleep_filled,
       ROUND(AVG(energyLevel), 2) AS avg_energy,
       ROUND(AVG(moodLevel),   2) AS avg_mood,
       ROUND(AVG(sleepHours),  2) AS avg_sleep
FROM DailyCheckins WHERE userId = 181 AND note = 'SEED-USER181-WEEK1';

SELECT '— ClassAttendance block (expect 5 rows in past 7 days) —' AS section;
SELECT COUNT(*) AS rows_total, COUNT(DISTINCT attended_at) AS distinct_days,
       MIN(attended_at) AS earliest, MAX(attended_at) AS latest
FROM ClassAttendances
WHERE user_id = 181
  AND attended_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY);

SELECT '— UserCycleData block —' AS section;
SELECT lastPeriodDate, averageCycleLength, dataProvided,
       currentCycleDay, currentPhase
FROM UserCycleData WHERE userId = 181;

SELECT '— WaterLog block (expect 5 rows in past 7 days) —' AS section;
SELECT COUNT(*) AS rows_total, COUNT(DISTINCT date) AS distinct_days,
       MIN(date) AS earliest, MAX(date) AS latest,
       ROUND(AVG(amountMl), 0) AS avg_mL
FROM WaterLogs
WHERE userId = 181
  AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY);


-- ═══════════════════════════════════════════════════════════════════════════
-- EXPECTED END-STATE on the Progress hub (Week period chip selected)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Hero
--   Greeting:   "Progress · {firstName} 🌿"
--   Goal label: "65kg by 2026-06-30" (controller's auto-format)
--   Big delta:  "−0.6 kg"   (currentValueKg 69.4 vs startValueKg 70.0)
--   Pace pill:  "On track" — only ~1 week elapsed; PaceEngine returns
--               warming_up/on_track depending on rounding. (Brief §6.1
--               WARMUP_THRESHOLD_WEEKS = 2 weeks; with 1 week elapsed
--               the pill may not render at all in `warming_up` state —
--               the hero degrades gracefully and shows just the delta.)
--   Goal ring:  ~12% (0.6 of 5kg target)
--   Stat tiles: Classes 5 · Streak 5🔥 · Sleep 6.9h · Energy 7.3
--               (See deviation #6: streak depends on today being
--               Sunday for the bug-free path.)
--   Period chip: Week (active)
--
-- Weight trend
--   Header: "−0.6 kg ↓ toward goal"
--   2 data points (last week's Monday at 70.0, this week's Monday at
--   69.4) connected by a short downward line.
--   Phase tint: follicular green band over today (cycleDay 8).
--   No projection line: WeightProjection requires ≥3 weekly points.
--
-- At a glance (4 rings)
--   Classes 5/5     = 100%  (green)
--   Sleep   6.9h/8h ≈  86%  (green/mint)
--   Water   1.7L/2.5L = 68% (amber — "drink more" nudge)
--   Goal           ≈  12%  (green)
--
-- Hydration
--   Headline tile: "💧 Water" + "68% · drink more" amber pill;
--                  big "1.7L" + "/2.5L target"; 5px amber progress bar
--   Phase tip:     follicular tip from NutritionTips.js
--                  ("Aim for 100g protein — absorption is up to 30%
--                  higher in this phase.")
--   Meals footer:  locked, "Meals · coming soon"
--
-- Symptoms
--   EXPECTED: empty-state "Complete 5 check-ins to see your trends".
--   Reason: SymptomDelta needs ≥5 datapoints in BOTH the current AND
--   previous period. Previous week (last ISO week) has 0 seeded rows
--   → all 4 rows return notEnoughData=true → screen shows the empty
--   state per progress_screen_v2.dart line 847 (`every notEnoughData`).
--   This is correct behaviour for a first-week QA pass — not a bug.
--
-- AI Insights
--   Dark green card (CF4 styling) with 🤖 + "FitHer AI" + "3 tips for
--   your phase". Honesty banner ("✨ Personalised insights coming
--   soon — phase-based tips for now."). 3 expandable tips keyed to
--   follicular (cycleDay 8), tinted green / amber / red per index.
--
-- Share Report
--   Download PDF: active (dark bg + accent green text, no icon).
--   Doctor Share: locked, lock icon, 0.45 opacity, snackbar on tap.
--
-- Footer
--   "Based on 6 check-ins this week"
--   "Photos & measurements →" link to ProgressScreenV1.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK SECTION  (commented out — UNCOMMENT to undo the seed)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WARNING: tables without a marker column use a 7-day-window WHERE
-- clause. If user 181 had pre-existing rows in that window, this
-- rollback removes them too. Run the audit first to see pre-existing
-- counts. Specifically:
--   • DailyCheckins: SAFE — note='SEED-USER181-WEEK1' marker.
--   • Goals: matches by user + status + the specific seed values
--     (start=70, target=65). If you edit those constants in the seed,
--     update the rollback to match.
--   • WeeklyCheckins / WaterLogs / ClassAttendances: NO marker column.
--     Date-window rollback. Audit first.
--   • UserCycleData: deletes only if the row matches the exact seed
--     values (lastPeriodDate=7 days ago, averageCycleLength=28).
--   • Users.status: NOT reverted. If user 181 was free pre-seed and
--     you want them free again post-rollback, manually set status=0.
--
-- START TRANSACTION;
--
-- DELETE FROM DailyCheckins
--  WHERE userId = 181 AND note = 'SEED-USER181-WEEK1';
--
-- DELETE FROM Goals
--  WHERE userId = 181 AND status = 'active'
--    AND startValueKg = 70.0 AND targetValueKg = 65.0;
--
-- DELETE FROM WeeklyCheckins
--  WHERE userId = 181
--    AND weekDate >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 14 DAY), '%Y-%m-%d');
--
-- DELETE FROM ClassAttendances
--  WHERE user_id = 181
--    AND attended_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY);
--
-- DELETE FROM WaterLogs
--  WHERE userId = 181
--    AND date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY);
--
-- DELETE FROM UserCycleData
--  WHERE userId = 181
--    AND lastPeriodDate = DATE_SUB(CURDATE(), INTERVAL 7 DAY)
--    AND averageCycleLength = 28
--    AND dataProvided = 1;
--
-- COMMIT;
--
-- ═══════════════════════════════════════════════════════════════════════════
-- end of file
-- ═══════════════════════════════════════════════════════════════════════════
