# PaidHomeScreenV2 — Phase Theming & AI Insight Verification

> Step-by-step procedure to flip user 181 through all 4 cycle phases and verify both API response (insight text) and visual theming (hero bg, accent, emoji, label).
> **Captured:** 2026-04-23

---

## Setup (one-time)

### User under test
| Field | Value |
|---|---|
| `id` | **181** |
| `firstName` | gj |
| `email` | tta@gmail.com |
| `userType` | User |
| `status` | true (active) |
| `targetWeightKg` | 76.5 |

### Captured BEFORE state — `UserCycleData` row id=18
| Column | Value |
|---|---|
| `userId` | 181 |
| `lastPeriodDate` | **2026-04-23** |
| `averageCycleLength` | 28 |
| `isRegular` | yes |
| `periodDuration` | 3–5 days |
| `flowType` | Moderate |
| `currentCycleDay` | 1 |
| `currentPhase` | menstrual |
| `dataProvided` | 1 |
| `updatedAt` | 2026-04-23 08:22:46 UTC |

> The RESTORE block at the bottom of `phase_theme_test.sql` puts these exact values back.

### Bearer token for user 181
Minted offline against `JWT_ACCESS_SECRET` from `.env`. Payload `{ email: "tta@gmail.com", id: 181 }`. No expiry.

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InR0YUBnbWFpbC5jb20iLCJpZCI6MTgxLCJpYXQiOjE3NzcxMzIyODR9.lK2bNaw9raCeYcuLzksZVfwjozPdbqKM6t-Uln0Kdcc
```

> Send as **`accessToken: <token>`** header (raw token, NO `Bearer ` prefix — the FitHer backend uses a custom header, see `middlewares/AuthorizationMW.js`).

### Server target
- **Backend:** `http://localhost:9000`
- **Endpoint:** `GET /users/home/dashboard`
- Backend must already be running (nodemon).

### Files in this folder
| File | Purpose |
|---|---|
| `phase_theme_test.sql` | The 4 UPDATE statements + RESTORE statement |
| `phase_theme_test.md` | This procedure (what you're reading) |
| `phase_insights_expected.md` | Ground-truth `insight` payload per phase |

---

## The procedure (repeat for each of 4 phases)

For each phase, the loop is:
**SQL UPDATE → curl dashboard → verify JSON → hot-reload Flutter → eyeball PaidHomeScreenV2**

### Step 1 · Apply the UPDATE for the phase under test
Open `phase_theme_test.sql` and run **only** the block for the phase you want. Don't run the whole file — each block stands alone.

### Step 2 · Hit the dashboard endpoint
```bash
curl -s http://localhost:9000/users/home/dashboard \
  -H "accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InR0YUBnbWFpbC5jb20iLCJpZCI6MTgxLCJpYXQiOjE3NzcxMzIyODR9.lK2bNaw9raCeYcuLzksZVfwjozPdbqKM6t-Uln0Kdcc" \
  | python -m json.tool
```
PowerShell variant:
```powershell
curl.exe -s http://localhost:9000/users/home/dashboard `
  -H "accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InR0YUBnbWFpbC5jb20iLCJpZCI6MTgxLCJpYXQiOjE3NzcxMzIyODR9.lK2bNaw9raCeYcuLzksZVfwjozPdbqKM6t-Uln0Kdcc" `
  | python -m json.tool
```

### Step 3 · Verify the JSON
Compare against `phase_insights_expected.md`. The four assertions per phase:
- `data.cycle.cycleDay` matches the target (8, 14, 20, or 2)
- `data.cycle.phase` matches the target string
- `data.cycle.phaseLabel` matches the human label
- `data.insight.text` matches the expected nudge text exactly
- `data.insight.accentHex` matches the expected hex

### Step 4 · Hot-reload Flutter
In the running app on your device/simulator, press **`r`** in the Flutter run terminal (hot reload) — or **`R`** for full restart if hot reload doesn't pick up the new dashboard call.
> The dashboard is fetched in `PaidHomeController` and the screen rebuilds when controller state updates. Pull-to-refresh on PaidHomeScreenV2 also re-fetches.

### Step 5 · Visually verify PaidHomeScreenV2
Use the lookup tables in the next section.

---

## Expected visuals per phase

All visual logic flows through `lib/widgets/new_home/phase_theme.dart` → `PhaseTheme.forPhaseString(dashboard.cycle?.phase)`. Every paid_home_v2 widget reads from this single source.

### Phase 1 — FOLLICULAR (cycleDay 8) ⚡
| Element | Expected | Where to look (file) |
|---|---|---|
| Hero background | **#163220** dark green | `lib/widgets/paid_home_v2/paid_hero.dart` |
| Top-bar / cycle-day badge | green `#6DC55A` | `lib/widgets/paid_home_v2/paid_hero_top_bar.dart` |
| Greeting block emoji | **⚡** | `lib/widgets/paid_home_v2/paid_hero_greeting.dart` |
| Phase label text | `Follicular Phase` | `paid_hero_top_bar.dart` / `paid_cycle_card.dart` |
| Insight card border | green tint | `lib/widgets/paid_home_v2/paid_insight_card.dart` (`insightAccent`) |
| Mood/feel selector accent | green | `lib/widgets/paid_home_v2/paid_feel_selector.dart` |
| Cycle card phase pill | `#6DC55A` green | `lib/widgets/paid_home_v2/paid_cycle_card.dart` |
| Modal slider colour (LogWeight / Sleep) | green tint | `log_weight_modal.dart`, `sleep_log_modal.dart` |

### Phase 2 — OVULATORY (cycleDay 14) ✨
| Element | Expected |
|---|---|
| Hero background | **#0A2420** near-black teal |
| Accent everywhere | teal **#5ECFB0** |
| Greeting emoji | **✨** |
| Phase label | `Ovulation` (note: not "Ovulation Phase" — backend label) |

### Phase 3 — LUTEAL (cycleDay 20) 🌙
| Element | Expected |
|---|---|
| Hero background | **#1E1208** dark warm |
| Accent everywhere | amber **#FAC775** |
| Greeting emoji | **🌙** |
| Phase label | `Luteal Phase` |

### Phase 4 — MENSTRUAL (cycleDay 2) 🌺
| Element | Expected |
|---|---|
| Hero background | **#1E0808** dark coral |
| Accent everywhere | coral **#FF8A8A** |
| Greeting emoji | **🌺** |
| Phase label | `Menstrual Phase` |

> Suggested screenshot capture: Hero, Insight card, Mood selector, Cycle card. One screenshot per phase = 4 total.

---

## Cleanup

After all 4 tests, run the RESTORE block at the bottom of `phase_theme_test.sql` to put user 181 back.

If you're done with this whole utility, delete the folder:
```bash
rm -rf C:/Users/dell/Desktop/dev/partner_backend/test/
```
This folder is scaffolding — nothing in it is wired into the app or referenced from any controller.

---

## Debugging hints

| Symptom | Likely cause | Fix |
|---|---|---|
| Dashboard returns `cycle: null` | `dataProvided != 1` after UPDATE, or row missing | Re-check the SQL — every UPDATE in `phase_theme_test.sql` keeps `dataProvided` untouched; if you ran the RESTORE then re-ran an UPDATE, `dataProvided=1` is preserved. Add `dataProvided = 1` to the UPDATE if needed. |
| API shows correct phase but Flutter still shows old colours | Flutter hasn't re-fetched the dashboard | Pull-to-refresh on PaidHomeScreenV2, or hot-restart with `R` (capital) |
| Hero bg looks right but insight card border doesn't follow | `paid_insight_card.dart` reads `PhaseTheme.forPhaseString(dashboard.cycle?.phase).insightAccent` — verify `dashboard.cycle?.phase` is non-null |
| `insight.text` is the follicular default no matter what phase you set | `DashboardController` line 475 `getInsight(phase)` — `phase` came back null, meaning `buildCycleAndPhase` returned `{cycle: null, phase: null}`. Check the cycle row again. |
| Token returns `"Invalid accessToken!"` | Token was minted against a different `JWT_ACCESS_SECRET` than the running server | Re-mint by re-running the probe Node script, or use the login curl below |
| `cycleDay` is one off from the table | UTC vs local timezone — `CyclePhaseCalculator` uses `Date.UTC(year, month, date)` for the day-only diff. Run the test mid-day to avoid midnight ambiguity. |

### Re-mint the token (if the existing one stops working)

```bash
cd C:/Users/dell/Desktop/dev/partner_backend
node -e "require('dotenv').config(); console.log(require('jsonwebtoken').sign({email:'tta@gmail.com',id:181}, process.env.JWT_ACCESS_SECRET));"
```

### Or login as user 181 the normal way
```bash
curl -X POST http://localhost:9000/users/login \
  -H "Content-Type: application/json" \
  -d '{"email":"tta@gmail.com","password":"<PASSWORD_HERE>"}'
```
The password isn't in any file — if you don't know it, re-mint the token with the snippet above (offline JWT signing is faster anyway).
