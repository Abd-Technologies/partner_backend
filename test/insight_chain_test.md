# Insight Chain End-to-End Verification

> Goal: prove that a one-character change in `StaticInsights.js` propagates through every layer (DB-dependent → API → Flutter parse → on-screen text) by changing exactly **one** thing.
> Method: insert a unique sentinel marker into one phase's text, then look for that marker at every layer.
> **Estimated time:** 5 min

---

## Pick your target phase

User 181 is currently in **menstrual** phase (per the dashboard probe). Two ways to run this test:

| Path | Edit which phase in `StaticInsights.js`? | Need to run SQL? |
|---|---|---|
| **A. Easy (recommended)** | `menstrual` | No — user 181 already in menstrual |
| **B. Original brief** | `follicular` | Yes — run TEST 1 from `phase_theme_test.sql` first to flip them into follicular |

The marker string is phase-agnostic on purpose: `TEST_INSERT_NUDGE_2026`. Use it however you go.

---

## Step-by-step

### Step 1 · Backup the current line you're about to edit
```bash
cp C:/Users/dell/Desktop/dev/partner_backend/helper/StaticInsights.js \
   C:/Users/dell/Desktop/dev/partner_backend/helper/StaticInsights.js.bak
```

### Step 2 · Insert the marker
Open `partner_backend/helper/StaticInsights.js` and edit the `text` field for your chosen phase.

**Path A (menstrual):** change line 17 from
```js
text: "Restorative phase. Gentle movement only. Your body is working hard — honor that. 🌺",
```
to
```js
text: "TEST_INSERT_NUDGE_2026 — Restorative phase. Gentle movement only. Your body is working hard — honor that. 🌺",
```

**Path B (follicular):** change line 5 from
```js
text: "Peak energy incoming. Great time to push on strength and cardio. Your body recovers faster this week. 💚",
```
to
```js
text: "TEST_INSERT_NUDGE_2026 — Peak energy incoming. Great time to push on strength and cardio. Your body recovers faster this week. 💚",
```

> **Path B only:** also run TEST 1 from `phase_theme_test.sql` now so user 181 ends up in `follicular`.

### Step 3 · Backend picks up the change
Nodemon auto-restarts on file save — no manual restart. Wait ~2 seconds.

### Step 4 · Verify the API layer
```bash
curl -sS http://localhost:9000/users/home/dashboard \
  -H "accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InR0YUBnbWFpbC5jb20iLCJpZCI6MTgxLCJpYXQiOjE3NzcxMzIyODR9.lK2bNaw9raCeYcuLzksZVfwjozPdbqKM6t-Uln0Kdcc" \
  | grep -o "TEST_INSERT_NUDGE_2026"
```
**Pass:** prints `TEST_INSERT_NUDGE_2026` once.
**Fail:** no output → marker didn't reach the API. Check: did the file save? Did nodemon restart (look at the backend terminal)?

### Step 5 · Hot-restart Flutter
In your `flutter run` terminal press **`R`** (capital — full restart, not hot reload). Hot reload `r` won't help because the dashboard fetch fires at controller `onInit`.

### Step 6 · Verify the on-screen layer
Open **PaidHomeScreenV2** on the device. Look at the dark-green insight card directly under the hero. The body text should start with `TEST_INSERT_NUDGE_2026 —`.

**Pass:** marker visible on screen.
**Fail troubleshooting:** see table below.

### Step 7 · Restore
```bash
mv C:/Users/dell/Desktop/dev/partner_backend/helper/StaticInsights.js.bak \
   C:/Users/dell/Desktop/dev/partner_backend/helper/StaticInsights.js
```
Nodemon restarts again. Re-curl to confirm marker is gone.

---

## What this verifies

If the marker shows up on screen, you've proven:

1. ✅ Backend reads `StaticInsights.js` fresh each request (not cached at boot)
2. ✅ `DashboardController.getDashboard` correctly invokes `getInsight(phase)`
3. ✅ The wrapped `insight` object reaches the JSON response
4. ✅ Flutter's `Insight.fromJson` parses the `text` field
5. ✅ `PaidInsightCard` renders `dashboard.insight.text` unmodified

A fail at any step pinpoints the layer that's broken.

---

## Failure interpretation

| Fail at step | What it means |
|---|---|
| Step 4 — marker not in curl output | Backend didn't reload; the file wasn't saved; nodemon ignored the change. Check terminal: nodemon prints `[restarting due to changes...]` |
| Step 4 — curl shows the OLD text and `phase` matches your edit | Wrong phase entry edited (Path A vs B mismatch with user 181's current phase) |
| Step 4 — `cycle: null` and insight is the **follicular** default | User 181's `dataProvided` got reset, or the cycle row was wiped. Re-run RESTORE in `phase_theme_test.sql`. |
| Step 6 — marker in API but not on screen | Flutter didn't refetch. Try pull-to-refresh on PaidHomeScreenV2; if still missing, kill the app and re-launch (full process restart, not just `R`) |
| Step 6 — insight card is missing entirely from the screen | `PaidInsightCard` early-returns `SizedBox.shrink()` when `insight.text == null` or empty (`paid_insight_card.dart` lines 21-25). Means JSON parsing dropped the field. Inspect raw curl output. |
| Step 6 — wrong text but right phase colour | `paid_insight_card.dart` line 101 reads `insight.text!` — should be impossible to mismatch. If it happens, you're looking at a stale build (run `flutter clean && flutter run`). |

---

## Cleanup checklist

- [ ] Restore `StaticInsights.js` from `.bak`
- [ ] Delete `StaticInsights.js.bak`
- [ ] Re-curl and confirm marker is gone
- [ ] If you used Path B, restore user 181's cycle row using the RESTORE block in `phase_theme_test.sql`
