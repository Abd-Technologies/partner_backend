# Expected `insight` Payload per Phase — Ground Truth

> Source: `partner_backend/helper/StaticInsights.js`
> Consumed by: `DashboardController.getDashboard` → `data.insight = { source: "static", text, accentHex }`
> Captured: 2026-04-23

The dashboard endpoint (`GET /users/home/dashboard`) calls `getInsight(phase)` after computing the phase via `CyclePhaseCalculator`. The text and accent must change per phase. If the API returns one of these strings, theming is wired correctly end-to-end.

---

## Per-phase expected values

| Phase | `insight.text` | `insight.accentHex` |
|---|---|---|
| `follicular` | `Peak energy incoming. Great time to push on strength and cardio. Your body recovers faster this week. 💚` | `#6DC55A` |
| `ovulatory`  | `Peak performance window. Best day for HIIT or a PR attempt. 💪` | `#5ECFB0` |
| `luteal`     | `Energy dipping gently. Lean toward pilates and yoga. Your body appreciates moderation now. 🌙` | `#FAC775` |
| `menstrual`  | `Restorative phase. Gentle movement only. Your body is working hard — honor that. 🌺` | `#FF8A8A` |

Fallback: `getInsight(null)` and any unknown phase return the **follicular** payload (lookup table miss → `insights.follicular`).

---

## Full expected dashboard subset (per phase)

For each test, the dashboard JSON should contain *at minimum* these keys:

### After running TEST 1 (follicular, cycleDay 8)
```json
{
  "data": {
    "cycle": {
      "dataProvided": true,
      "cycleDay": 8,
      "phase": "follicular",
      "phaseLabel": "Follicular Phase",
      "periodInDays": 20,
      "averageCycleLength": 28
    },
    "insight": {
      "source": "static",
      "text": "Peak energy incoming. Great time to push on strength and cardio. Your body recovers faster this week. 💚",
      "accentHex": "#6DC55A"
    }
  }
}
```

### After running TEST 2 (ovulatory, cycleDay 14)
```json
{
  "data": {
    "cycle": {
      "dataProvided": true,
      "cycleDay": 14,
      "phase": "ovulatory",
      "phaseLabel": "Ovulation",
      "periodInDays": 14,
      "averageCycleLength": 28
    },
    "insight": {
      "source": "static",
      "text": "Peak performance window. Best day for HIIT or a PR attempt. 💪",
      "accentHex": "#5ECFB0"
    }
  }
}
```

### After running TEST 3 (luteal, cycleDay 20)
```json
{
  "data": {
    "cycle": {
      "dataProvided": true,
      "cycleDay": 20,
      "phase": "luteal",
      "phaseLabel": "Luteal Phase",
      "periodInDays": 8,
      "averageCycleLength": 28
    },
    "insight": {
      "source": "static",
      "text": "Energy dipping gently. Lean toward pilates and yoga. Your body appreciates moderation now. 🌙",
      "accentHex": "#FAC775"
    }
  }
}
```

### After running TEST 4 (menstrual, cycleDay 2)
```json
{
  "data": {
    "cycle": {
      "dataProvided": true,
      "cycleDay": 2,
      "phase": "menstrual",
      "phaseLabel": "Menstrual Phase",
      "periodInDays": 26,
      "averageCycleLength": 28
    },
    "insight": {
      "source": "static",
      "text": "Restorative phase. Gentle movement only. Your body is working hard — honor that. 🌺",
      "accentHex": "#FF8A8A"
    }
  }
}
```

`periodInDays` is computed as `max(0, averageCycleLength - cycleDay)` in `DashboardController.buildCycleAndPhase`.

---

## Failure interpretations

| What you see | What it likely means |
|---|---|
| `insight.text` doesn't change between phases | `DashboardController` is not passing `phase` into `getInsight()`, or `phase` is null because cycle data is missing/`dataProvided != 1` |
| `insight.accentHex` is correct but text is wrong | Someone edited `StaticInsights.js` text without updating this doc — re-capture |
| `cycle.phase` is `follicular` after every UPDATE | Backend was not restarted, or the SQL UPDATE didn't commit, or `CyclePhaseCalculator` is reading a cached value |
| `cycle.cycleDay` is off by 1 from the table above | Local-time vs UTC discrepancy in `CyclePhaseCalculator` (it uses `Date.UTC` for the day-only diff) — re-check around midnight |
| `cycle == null` and `phase == null` | `dataProvided` was reset to 0, or the `UserCycleData` row was deleted — re-run the relevant UPDATE |
