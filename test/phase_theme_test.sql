-- =============================================================================
-- PaidHomeScreenV2 — Phase Theming & Insight Verification Test Helpers
-- =============================================================================
-- Purpose:  Cycle user 181 (tta@gmail.com / "gj") through each of the 4 cycle
--           phases without touching the cycle setup UI, so we can verify that
--           PaidHomeScreenV2 responds correctly to phase changes.
--
-- Database: testing  (MySQL on 127.0.0.1:3306, user=root, dev config)
-- Affects:  ONE row in UserCycleData (id=18, userId=181). Nothing else.
-- Reversible: see "RESTORE" block at the bottom.
-- =============================================================================
--
-- BEFORE STATE — captured 2026-04-23 08:22 UTC
--   id=18, userId=181, lastPeriodDate='2026-04-23', averageCycleLength=28,
--   isRegular='yes', periodDuration='3–5 days', flowType='Moderate',
--   currentCycleDay=1, currentPhase='menstrual', dataProvided=1
--
-- PHASE BOUNDARIES (from CyclePhaseCalculator.js with length=28)
--   menstrual:  cycleDay 1–5     (round(28*0.18)=5)
--   follicular: cycleDay 6–13    (round(28*0.46)=13)
--   ovulatory:  cycleDay 14–16   (round(28*0.57)=16)
--   luteal:     cycleDay 17+
--
-- CYCLE-DAY MATH
--   cycleDay = (daysSince(lastPeriodDate, today) % length) + 1
--   ⇒ to land on cycleDay N, set lastPeriodDate = today − (N − 1) days.
--   The original spec wrote "today − N days" (off by one); we honour the
--   intent of hitting the requested cycleDay value, not the literal date math.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1 — FOLLICULAR  (target cycleDay 8, energy ramping up, green theme)
--   Expected dashboard: cycle.cycleDay=8, cycle.phase='follicular',
--                       cycle.phaseLabel='Follicular Phase', insight.accentHex='#6DC55A'
--   Expected hero bg = #163220, accent = #6DC55A green, emoji ⚡
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE UserCycleData
SET    lastPeriodDate    = DATE_SUB(CURDATE(), INTERVAL 7 DAY),
       averageCycleLength = 28,
       currentCycleDay    = 8,
       currentPhase       = 'follicular',
       updatedAt          = NOW()
WHERE  userId = 181;


-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2 — OVULATORY  (target cycleDay 14, peak performance, teal theme)
--   Expected dashboard: cycle.cycleDay=14, cycle.phase='ovulatory',
--                       cycle.phaseLabel='Ovulation', insight.accentHex='#5ECFB0'
--   Expected hero bg = #0A2420, accent = #5ECFB0 teal, emoji ✨
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE UserCycleData
SET    lastPeriodDate    = DATE_SUB(CURDATE(), INTERVAL 13 DAY),
       averageCycleLength = 28,
       currentCycleDay    = 14,
       currentPhase       = 'ovulatory',
       updatedAt          = NOW()
WHERE  userId = 181;


-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3 — LUTEAL  (target cycleDay 20, energy dipping, amber theme)
--   Expected dashboard: cycle.cycleDay=20, cycle.phase='luteal',
--                       cycle.phaseLabel='Luteal Phase', insight.accentHex='#FAC775'
--   Expected hero bg = #1E1208, accent = #FAC775 amber, emoji 🌙
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE UserCycleData
SET    lastPeriodDate    = DATE_SUB(CURDATE(), INTERVAL 19 DAY),
       averageCycleLength = 28,
       currentCycleDay    = 20,
       currentPhase       = 'luteal',
       updatedAt          = NOW()
WHERE  userId = 181;


-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4 — MENSTRUAL  (target cycleDay 2, restorative, coral theme)
--   Expected dashboard: cycle.cycleDay=2, cycle.phase='menstrual',
--                       cycle.phaseLabel='Menstrual Phase', insight.accentHex='#FF8A8A'
--   Expected hero bg = #1E0808, accent = #FF8A8A coral, emoji 🌺
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE UserCycleData
SET    lastPeriodDate    = DATE_SUB(CURDATE(), INTERVAL 1 DAY),
       averageCycleLength = 28,
       currentCycleDay    = 2,
       currentPhase       = 'menstrual',
       updatedAt          = NOW()
WHERE  userId = 181;


-- ─────────────────────────────────────────────────────────────────────────────
-- RESTORE — put user 181 back to the state captured on 2026-04-23 08:22 UTC.
-- Run this once you finish the 4 tests.
--
-- NB: This restores the literal date that was current at capture time. If you
-- run this on a day other than 2026-04-23 the user will appear N days into
-- their cycle rather than on day 1 — fix lastPeriodDate to today's date if
-- you want to mirror the original "day 1, period started today" state.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE UserCycleData
SET    lastPeriodDate     = '2026-04-23',
       averageCycleLength = 28,
       isRegular          = 'yes',
       periodDuration     = '3–5 days',
       flowType           = 'Moderate',
       currentCycleDay    = 1,
       currentPhase       = 'menstrual',
       dataProvided       = 1,
       updatedAt          = NOW()
WHERE  userId = 181;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFY — read-only sanity check after any UPDATE above.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT id, userId, lastPeriodDate, averageCycleLength,
--        currentCycleDay, currentPhase, dataProvided, updatedAt
-- FROM   UserCycleData
-- WHERE  userId = 181;
