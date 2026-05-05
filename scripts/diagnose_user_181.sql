-- ═══════════════════════════════════════════════════════════════════════════
-- Diagnostic: why does the Progress hub show empty for the phone-logged-in
-- user? READ-ONLY. No data is modified.
--
-- Run against THE SAME database the phone-facing backend uses (NOT the
-- local 127.0.0.1 in config.json's `development` block — that's a dev DB,
-- almost certainly not what staging/prod hits). On the real backend host:
--
--   mysql -h <real-host> -u <real-user> -p <real-db> < diagnose_user_181.sql
--
-- Or paste each query into a connected client.
-- ═══════════════════════════════════════════════════════════════════════════

-- Q0 — confirm we're on the right database (sanity check)
SELECT DATABASE() AS current_db, @@hostname AS host, NOW() AS server_time;

-- Q1 — does user 181 exist? what's their first name + paid status?
SELECT id, firstName, lastName, email, status, useNewProgressHub, createdAt
FROM Users
WHERE id = 181;

-- Q2 — active goal for user 181?
SELECT id, userId, type, startValueKg, targetValueKg, currentValueKg,
       startDate, targetDate, status, createdAt
FROM Goals
WHERE userId = 181;

-- Q3 — any weekly weights at all (not filtered by date)?
SELECT id, userId, weekDate, weightKg, createdAt
FROM WeeklyCheckins
WHERE userId = 181
ORDER BY weekDate DESC
LIMIT 10;

-- Q4 — any daily check-ins at all?
SELECT id, userId, date, energyLevel, moodLevel, sleepHours, note, createdAt
FROM DailyCheckins
WHERE userId = 181
ORDER BY date DESC
LIMIT 10;

-- Q5 — any class attendances at all?
SELECT id, user_id, attended_at, createdAt
FROM ClassAttendances
WHERE user_id = 181
ORDER BY attended_at DESC
LIMIT 10;

-- Q6 — any water logs at all?
SELECT id, userId, date, amountMl, createdAt
FROM WaterLogs
WHERE userId = 181
ORDER BY date DESC
LIMIT 10;

-- Q7 — WHO is "gj"? The phone screenshot shows "Progress · gj 🌙" so the
-- logged-in user has firstName starting with "gj". Find their actual ID.
SELECT id, firstName, lastName, email, status
FROM Users
WHERE firstName LIKE 'gj%' OR firstName = 'gj'
ORDER BY id DESC
LIMIT 10;

-- Q8 — bonus: show the 5 most-recently-active users so we can spot the
-- phone account regardless of name spelling.
SELECT id, firstName, lastName, email, status, updatedAt
FROM Users
WHERE userType = 'User'
ORDER BY updatedAt DESC
LIMIT 5;

-- Q9 — has the seed marker landed ANYWHERE for ANY user? If we wrote
-- 'SEED-USER181-WEEK1' rows but they hit a different userId by mistake,
-- this surfaces it.
SELECT userId, COUNT(*) AS n
FROM DailyCheckins
WHERE note = 'SEED-USER181-WEEK1'
GROUP BY userId;
