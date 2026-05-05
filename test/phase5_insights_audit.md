# Phase 5 Static Insights System — Complete Reverse-Engineering

> Read-only audit. No code touched. All text and code below is pasted verbatim from the source files.
> Files inspected: 8 (data/static_insights.dart, services/insight_service.dart, services/accuracy_service.dart, services/progress_service.dart, phase_config.dart, services/cycle_engine.dart, widgets/insight_card.dart, widgets/user_home_screen.dart).
> Generated 2026-04-26.

---

## TL;DR for the founder

This is a **2,200-line lookup engine that resolves to a 22-template static dataset** with no per-user state, no rotation within a cycleDay, and no machine learning. On a 28-day cycle a user sees **18 unique nudges**, of which **10 days are visual repeats of the previous day** (longest streak: 3 days of the same text). The rendered card has more visual chrome (pills, confidence badge, expandable body) than the V2 paid card.

If "AI insight" is the marketing claim, the gap between branding and substance is meaningful.

Recommendation at the end (Section G).

---

# PART A — DATA INVENTORY

## A1. Every cycle-aware nudge (verbatim from `lib/data/static_insights.dart`)

The file uses two custom data classes. Only `dayStart`, `dayEnd`, `title`, `body` are populated per template — there are no energy/mood/craving/workout fields directly on the nudge (those live in a separate `PhaseConfig` lookup, see Part D).

```dart
class NudgeTemplate {
  final int dayStart;
  final int dayEnd;
  final String title;
  final String body;
  …
}
```

### Phase: `menstrual` — 5 templates

| Day range | Title | Body |
|---|---|---|
| **1** | `Day 1 - Take it easy` | `Your period just started. Low energy is completely normal. A gentle stretch or rest day is perfect. Listen to your body.` |
| **2** | `Day 2 - Rest is productive` | `Still early in your cycle. Energy stays low. Gentle Yoga or Stretch & Restore are ideal if you move at all.` |
| **3** | `Day 3 - Slow and steady` | `Energy starting to lift slightly. A light session could feel good, but no pressure. Your body is still recovering.` |
| **4** | `Day 4 - The shift begins` | `You may notice energy creeping back. A low-intensity session like Pilates could feel surprisingly good today.` |
| **5** | `Day 5 - Almost through` | `Your period is wrapping up. Energy is climbing. Tomorrow you will feel the difference. Today, keep it gentle.` |

### Phase: `follicular` — 5 templates

| Day range | Title | Body |
|---|---|---|
| **6** | `Day 6 - Energy is back` | `Estrogen is rising and you should feel it. Great day to get back into a rhythm. Strength or Cardio will feel right.` |
| **7–8** | `Rising energy` | `Your body is building momentum. Best window for challenging workouts. Push yourself a little - you can handle it.` |
| **9–10** | `Momentum week` | `Energy climbing steadily. You are in your power phase. High-intensity sessions will feel amazing this week.` |
| **11–12** | `Peak building` | `Almost at your energy peak. Motivation should be high. Great time to try a new class or increase intensity.` |
| **13** | `Tomorrow is peak` | `Energy nearly at its highest. Fuel up, hydrate, get ready - tomorrow and the next few days are your power window.` |

### Phase: `ovulatory` — 3 templates

| Day range | Title | Body |
|---|---|---|
| **14** | `Day 14 - Peak energy` | `This is your peak. Energy, motivation, confidence all at highest. Go all out - Power HIIT, Cardio Blast, whatever excites you.` |
| **15** | `Still at the top` | `Energy remains high. Social energy also peaking - a live group session will feel incredible. Feed off the community energy.` |
| **16** | `Last day of peak` | `Power window closing. Make the most of today. Tomorrow the shift begins - but today, you are unstoppable.` |

### Phase: `luteal` — 5 templates

| Day range | Title | Body |
|---|---|---|
| **17–18** | `Gentle shift` | `Energy starts to ease. You may still feel strong, but do not push too hard. Power Yoga or Pilates are perfect.` |
| **19–21** | `Mid-luteal` | `Progesterone rising. You might feel more tired. That is normal. A moderate session will feel great without draining you.` |
| **22–23** | `Cravings may appear` | `Craving sugar or carbs? That is your hormones - not weakness. A gentle workout can actually help reduce cravings.` |
| **24–25** | `Winding down` | `Energy low. Mood might dip. Hardest part of the cycle. Be kind to yourself. Gentle Yoga or Stretch is enough.` |
| **26–28** | `Almost there` | `Period approaching. Energy and mood at lowest. Rest is a valid choice. If you move, keep it gentle. Better days coming.` |

---

## A2. Generic nudges (no-cycle-data fallback) — 4 entries

```dart
class GenericNudge {
  final String id;       // 'A' | 'B' | 'C' | 'D'
  final String title;
  final String body;
  …
}
```

| ID | Title | Body |
|---|---|---|
| **A** | `Good morning!` | `Ready to move today? Check out today's sessions and find one that fits your energy. Add cycle data for personalized insights.` |
| **B** | `Your body, your pace` | `Some days are high energy, some are not. Listen to your body and pick the right session. Cycle tracking makes this more accurate.` |
| **C** | `Stay consistent` | `The best workout is the one you show up for. Browse today's schedule and find your moment.` |
| **D** | `You + 30 women` | `Today's sessions are filling up. Join the community and get moving. Your body will thank you.` |

These depend only on `DateTime.now()` (for the day-of-year calculation). No cycle data, no user state, no API.

---

## A3. Inventory totals

| Metric | Value |
|---|---|
| **Cycle-aware nudges (total)** | **18** |
| menstrual | 5 (one per day, days 1–5) |
| follicular | 5 (covers 8 days, 6–13) |
| ovulatory | 3 (one per day, days 14–16) |
| luteal | 5 (covers 12 days, 17–28) |
| **Generic nudges** | **4** (A, B, C, D) |
| **Grand total templates** | **22** |

### Day coverage gaps
- Days **1–28 are fully covered** for a length=28 cycle. No gaps.
- For `cycleDay > 28` (late period, not impossible because `CycleEngine` does not modulo), `_getNudge` falls back to the **last template of the user's phase**. Phase stays `luteal`, so the user sees `Almost there` indefinitely until the period actually starts.
- For non-28 cycle lengths, the phase boundaries scale (see CycleEngine in Part D), but **the nudge `dayStart`/`dayEnd` ranges do NOT scale** — they're hardcoded to a 28-day cycle. A user with a 35-day cycle in luteal day 33 still gets `Almost there` (it's the last template), but a user with a 21-day cycle would skip the late-luteal nudges entirely. This is a latent bug for non-28 users.

### Format consistency
- All `NudgeTemplate` entries populate **all 4 fields** (dayStart, dayEnd, title, body). Consistent.
- All `GenericNudge` entries populate all 3 fields (id, title, body). Consistent.
- No `NudgeTemplate` carries energy/mood/craving/workout — those come from `PhaseConfig` and are bolted on by `InsightService.getTodayInsight` (see Part B).
- Body length range: shortest = 113 chars (`Day 4`), longest = 162 chars (`Last day of peak`). All fit within the V2 card's wrap, but on the OLD card any body > 120 chars triggers a "Read more" expander.

---

# PART B — SELECTION LOGIC

## B1. `InsightService.getTodayInsight()` walkthrough

```dart
static Insight getTodayInsight(CycleInfo? cycleInfo) {
  if (cycleInfo == null) {
    return _getGenericInsight();              // ← branch 1: no cycle data
  }

  final phase = cycleInfo.phase;
  final day   = cycleInfo.cycleDay;

  final nudge   = _getNudge(phase, day);      // ← cycle-aware lookup
  final energy  = _getEnergy(phase, day);     // ← from PhaseConfig.energy
  final mood    = _getMood(phase, day);
  final craving = _getCraving(phase, day);    // ← luteal sub-key applied
  final workout = _getWorkout(phase, day);    // ← luteal sub-key applied

  return Insight(
    title:   nudge?.title ?? 'Your daily insight',
    body:    nudge?.body  ?? 'Listen to your body and move at your own pace.',
    energy:  energy,
    mood:    mood,
    craving: craving,
    workout: workout,
  );
}
```

**Inputs** — A single `CycleInfo?` (`cycle_engine.CycleInfo`, NOT `home_dashboard_model.CycleInfo` — see Part D1). Has only `cycleDay` (int) + `phase` (String).

**Branching**
| Condition | Behavior |
|---|---|
| `cycleInfo == null` | Returns generic nudge (text-only, no pills) |
| Known phase + valid day | Returns full Insight: nudge + 4 pills |
| **Unknown phase string** | `_getNudge` returns `null` → defaults `'Your daily insight' / 'Listen to your body…'`. All 4 pill lookups also return `null`. The card still renders. |
| **`day` falls outside any template's range** (e.g. `cycleDay = 0`) | `_getNudge` linear-scans, finds nothing, returns the **LAST template** in the phase list (line 73). Same fallback for energy/mood. |
| **Late period (day > 28)** | Same — falls to last template. Phase stays `luteal` (CycleEngine never re-modulos). |

**Returns** an `Insight` object — never throws, never returns null. Every branch is fully covered.

---

## B2. Day-of-year logic for generic nudges

```dart
static GenericNudge getGenericNudge() {
  final dayOfYear = DateTime.now()
      .difference(DateTime(DateTime.now().year))
      .inDays;
  return genericNudges[dayOfYear % 4];
}
```

**Confirmed behavior**
- `dayOfYear` = days since Jan 1 of the current year (calculated using **local** `DateTime.now()`, not UTC).
- `dayOfYear % 4` selects index 0–3 → A/B/C/D.
- **Across all users** opening the app on the same calendar day in the same time zone → all see the same generic nudge.
- Generic nudge **changes every calendar day** in a 4-day cycle: A→B→C→D→A→…

**Edge case** — `DateTime(year)` is local midnight on Jan 1. `DateTime.now()` is also local. So `dayOfYear` is local and rolls over at local midnight. A user in another time zone may see a different generic on the same UTC day.

**Edge case 2** — the year boundary: Dec 31 → `dayOfYear = 364` (or 365 on a leap year) → index `364 % 4 = 0` (A). Jan 1 → `dayOfYear = 0` → index `0 % 4 = 0` (A). So **the user sees A on Jan 1 AND on Dec 31 of a non-leap year** — a 1-day "skip" in the rotation around the year boundary. Harmless but worth knowing.

---

## B3. Phase-aware nudge matching

```dart
static NudgeTemplate? _getNudge(String phase, int day) {
  final templates = StaticInsights.nudges[phase];
  if (templates == null) return null;             // unknown phase → null

  for (final template in templates) {
    if (day >= template.dayStart && day <= template.dayEnd) {
      return template;
    }
  }

  // Day exceeds template range (e.g. late period, day > 28)
  // Return the last template for the phase
  return templates.isNotEmpty ? templates.last : null;
}
```

**Confirmed behavior**
- `cycleDay = 6, 7, 8` in follicular: day 6 hits the `[6,6]` template (`Day 6 - Energy is back`); days 7 and 8 both hit `[7,8]` (`Rising energy`).
- **Same `cycleDay` always returns the same template.** No randomization, no time-of-day variance, no per-user salt.
- **Late period** (day 29+): falls into the `templates.last` fallback path → user stays on `Almost there` until period restarts.

---

## B4. Confidence calculation

The `Insight` returned by `InsightService` does **not** carry a confidence value. Confidence is computed **separately** by `AccuracyService` and passed independently into the widget:

```dart
// user_home_screen.dart:155-163
double? accuracyPercent;
final recentResponse = await checkinRepo.getDailyCheckinsRecent(
  accessToken: token, limit: 7);
if (recentResponse.body != null && …) {
  final recentList = (recentResponse.body['data'] as List)
      .whereType<Map<String, dynamic>>().toList();
  final accuracy = AccuracyService.getRolling7DayAccuracy(recentList);
  if (accuracy != null) {
    accuracyPercent = accuracy * 100;
  }
}
```

### What confidence represents (`accuracy_service.dart`)

```dart
static double calculateDayAccuracy({
  required int predictedEnergy,
  required int actualEnergy,
  required int predictedMood,
  required int actualMood,
}) {
  final energyMatch = _matchScore(predictedEnergy, actualEnergy);
  final moodMatch   = _matchScore(predictedMood,   actualMood);
  return (energyMatch + moodMatch) / 2.0;
}

static double _matchScore(int predicted, int actual) {
  final diff = (predicted - actual).abs();
  if (diff <= 1) return 1.0;     // within 1 point = perfect match
  if (diff == 2) return 0.5;     // 2 off = half credit
  return 0.0;                     // 3+ off = miss
}

static double? getRolling7DayAccuracy(List<Map<String, dynamic>> recentCheckins) {
  …
  if (count < 3) return null;
  final accuracy = totalAccuracy / count;
  if (accuracy < 0.60) return null;   // ⚠️ "Positive framing"
  return accuracy.clamp(0.0, 1.0);
}
```

| Aspect | Detail |
|---|---|
| **What it measures** | How well `PhaseConfig.energy[phase][day].energy` and `.mood` predicted what the user actually self-reported in their daily check-in |
| **Source data** | `predictedEnergy/Mood` (saved at check-in time from `_insight?.energy?.energy` etc.) vs `energyLevel/moodLevel` (user's actual answer) |
| **Suppression rules** | Returns `null` if **fewer than 3 valid check-ins** in the last 7 days, OR if **accuracy < 60%** ("positive framing" — bad numbers are hidden) |
| **Display** | OLD card: `Confidence: 78%` text in the header row, only when non-null |
| **Effect on nudge selection** | **NONE.** Confidence is decoration. The same nudge is picked regardless of accuracy. |

**Implication:** the accuracy% number on screen is a **vanity metric** — when it would make the engine look bad, it disappears. It does not feed back into anything.

---

# PART C — RENDER

## C1. Visual layout (`lib/widgets/insight_card.dart` — 277 lines)

| Element | Style |
|---|---|
| Container shape | Rounded 16, white bg, `AppColors.primary` 4px left border, soft shadow (8px blur, 8% black) |
| Outer margin | `EdgeInsets.symmetric(horizontal: 16.w)` |
| Inner padding | `EdgeInsets.all(16.w)` |
| Header text | `Day {n} of your cycle • {Phase} Phase` (cycle data) OR `Welcome back` (no cycle data) — 11sp, w500, `AppColors.textHint` |
| Confidence badge | `Confidence: {n}%` right-aligned in same header row, only when accuracy != null. Same style as phase label. |
| Nudge title | 15sp, w600, `AppColors.textPrimary` |
| Nudge body | 13sp, w400, `AppColors.textTertiary`, line height 1.5; clamped to 3 lines when collapsed |
| "Read more" / "Show less" | Conditional: only if body length > 120 chars; 13sp, w500, `AppColors.primary`; toggles `_expanded` state with `setState`; cross-fades over 200ms via `AnimatedCrossFade` |
| Pill row | Three pills inline (energy, mood, craving) with `Flexible` + `SizedBox(width: 8.w)` separators. Only renders if `_hasCycleData`. |
| Pill colors | level >= 4: green bg `#E4F9D7`, secondary text. level == 3: amber bg `#FEF3C7`, brown text `#92400E`. level <= 2: grey bg `#F3F4F6`, hint text. |
| Craving pill | Always grey bg; text `Cravings: {craving}` or `No cravings` if `craving == 'none'` |
| "Add cycle data" link | 13sp, w500, primary green, → `onAddCycleData` callback. Only rendered when `!_hasCycleData`. |
| "View recommended sessions →" | 13sp, w500, primary green, → `onViewSessions` callback. Only rendered when `_hasCycleData && onViewSessions != null`. |

**Workout pill**: not actually rendered on the card. `Insight.workout` exists in the model but `_buildPillsRow` only emits energy / mood / craving (line 181–200). The workout intensity/types/avoid data is silently dropped at the render layer.

---

## C2. UI tree (outermost → innermost)

```
Container (white card, left border, shadow)
└── Padding (16.w all)
    └── Column (start-aligned, no main-axis-min)
        ├── Row [_buildPhaseRow]
        │   ├── Expanded Text  ("Day N of your cycle • Phase Phase" OR "Welcome back")
        │   └── Text             (Confidence: NN%)        — conditional on accuracyPercent != null
        ├── SizedBox(height: 10.h)
        ├── Text                  (insight.title — w600 15sp)
        ├── SizedBox(height: 6.h)
        ├── Column [_buildNudgeBody]
        │   ├── AnimatedCrossFade
        │   │   ├── firstChild  (collapsed body, 3-line clamp + ellipsis)
        │   │   └── secondChild (full body)
        │   └── GestureDetector (Read more / Show less)   — conditional: body.length > 120
        ├── SizedBox(height: 12.h)
        ├── Row [_buildPillsRow]                          — conditional: _hasCycleData
        │   ├── Flexible Container (energy pill)         — conditional: insight.energy != null
        │   ├── SizedBox(width: 8.w)
        │   ├── Flexible Container (mood pill)            — conditional: insight.mood != null
        │   ├── SizedBox(width: 8.w)
        │   └── Flexible Container (craving pill)         — conditional: insight.craving != null
        ├── GestureDetector [_buildAddCycleDataLink]      — conditional: !_hasCycleData
        ├── SizedBox(height: 10.h)
        └── GestureDetector ("View recommended sessions →") — conditional: _hasCycleData && onViewSessions != null
```

---

## C3. Tap interactions

| Tappable element | Action |
|---|---|
| `Read more` / `Show less` | Toggles internal `_expanded` state; no navigation |
| Add cycle data link | Calls `widget.onAddCycleData` — wired on old home to `Get.to(() => const CycleSettingsScreen())` |
| View recommended sessions link | Calls `widget.onViewSessions` — wired on old home to `Get.to(() => const RecommendedSlotsScreen())` |
| **The card itself** | **Not tappable.** No InkWell or GestureDetector wraps the body. |

---

## C4. Old `insight_card.dart` vs V2 `paid_insight_card.dart` — side-by-side

| Aspect | Old `insight_card.dart` | V2 `paid_insight_card.dart` |
|---|---|---|
| State type | `StatefulWidget` (for `_expanded` toggle) | `StatelessWidget` |
| Background | White `#FFFFFF` | Dark green `#163220` (hardcoded) |
| Border | 4px solid `AppColors.primary` LEFT only | 1px all-sides, accent @ 16% opacity |
| Shape | RoundedRectangle radius 16 | RoundedRectangle radius 18 |
| Header text | `Day N of your cycle • {Phase} Phase` (dynamic) | `FitHer AI · Today's insight` (hardcoded — no day or phase) |
| Header color | `AppColors.textHint` | Phase accent (FitHer AI) + 25% white (subtitle) |
| Icon | None | 26×26 robot icon (`Icons.smart_toy_outlined`), accent-tinted bg + border |
| Confidence badge | Yes (right-aligned in header), shown when ≥3 check-ins and ≥60% | None |
| Nudge title (h6 line) | Rendered (15sp w600 textPrimary) | NOT rendered — body only |
| Body color | `AppColors.textTertiary` (dark grey) | White @ 62% opacity (legible on dark green bg) |
| Body line-height | 1.5 | 1.6 |
| Read more / Show less | Yes (when body > 120 chars) | No — full body always shown |
| Pills row (energy/mood/craving) | Yes — 3 pills, color-coded by level | None |
| Add cycle data CTA | Yes (when no cycle data) | None — card just disappears |
| View recommended sessions CTA | Yes (when cycle data) | None |
| Empty state | Renders "Welcome back" header + generic nudge | `SizedBox.shrink()` — disappears entirely |
| Source of accent color | None — uses `AppColors.primary` everywhere | `dashboard.insight.accentHex` (with `PhaseTheme` fallback) |
| Margin | 16.w horizontal | None (relies on parent padding) |

**What V2 has that old doesn't:** dark theme, AI branding (header + robot icon), backend-driven accent color.
**What old has that V2 doesn't:** title line, expandable body, energy/mood/craving pills, confidence badge, two action CTAs (add cycle data, view sessions), per-day phase label in header.

---

# PART D — INTEGRATIONS

## D1. The TWO `CycleInfo` classes

**Yes — two completely different classes with the same name.**

### `cycle_engine.CycleInfo` — used by InsightService

```dart
// lib/data/services/cycle_engine.dart
class CycleInfo {
  final int cycleDay;
  final String phase;
  const CycleInfo({required this.cycleDay, required this.phase});
}
```
Fields: **2** (cycleDay, phase). All required, all non-null.

### `home_dashboard_model.CycleInfo` — used by V2 PaidHomeController

```dart
// lib/data/models/home_dashboard/home_dashboard_model.dart
class CycleInfo {
  final bool? dataProvided;
  final int? cycleDay;
  final String? phase;
  final String? phaseLabel;
  final int? periodInDays;
  final int? averageCycleLength;
  …
}
```
Fields: **6**. All nullable.

### Field overlap

| Field | cycle_engine | home_dashboard_model |
|---|---|---|
| `cycleDay` | `int` (req'd) | `int?` |
| `phase` | `String` (req'd) | `String?` |
| `dataProvided` | — | `bool?` |
| `phaseLabel` | — | `String?` |
| `periodInDays` | — | `int?` |
| `averageCycleLength` | — | `int?` |

**Implication:** any future code that wants to use V2 dashboard data with `InsightService` needs a 2-line adapter:
```dart
final eng = cycle_engine.CycleInfo(
  cycleDay: dashboard.cycle?.cycleDay ?? 0,
  phase:    dashboard.cycle?.phase    ?? 'follicular',
);
```
The two namespaces collide if both are imported in the same file — needs `as` aliasing.

---

## D2. Where `InsightService` is called from

**Grep result (every call site in `lib/`):**

```
lib/data/services/insight_service.dart:23   // declaration
lib/data/services/insight_service.dart:24   // private constructor
lib/data/services/insight_service.dart:28   // method declaration
lib/widgets/user_home_screen.dart:44        // import
lib/widgets/user_home_screen.dart:136       // CALL: InsightService.getTodayInsight(cycleInfo)
lib/widgets/insight_card.dart:5             // import (only for the Insight return type)
```

**Confirmed**
- **Exactly one call site:** `lib/widgets/user_home_screen.dart` line 136 — the OLD home screen.
- **V2 paid home does NOT call it.** PaidHomeScreenV2 reads `dashboard.insight.text` from the backend instead (which is the simpler `StaticInsights.js` 4-string table).
- `widgets/insight_card.dart` imports it only to reference the `Insight` type — never invokes it.

---

## D3. State management & caching

**No caching.** State lives in `_UserHomeScreenState`:

```dart
// user_home_screen.dart:96-102
CycleInfo? _cycleInfo;
Insight?   _insight;
double?    _accuracyPercent;
int        _checkinsThisWeek = 0;
bool       _hasCheckinToday = false;
bool       _hasCycleData = false;
bool       _showCheckinPrompt = false;
```

**Refresh triggers:**

| Trigger | What happens |
|---|---|
| `initState` (post-frame callback, line 107–109) | `_loadInsightData()` runs — fires 4 sequential API calls, then `setState` |
| Pull-to-refresh on the home `RefreshIndicator` (line 192–195) | Calls `homeController.getUserHomeFunc()` and `SocketController.getSlot()` — **does NOT call `_loadInsightData`**. So the insight card does NOT refresh on pull. |
| After daily check-in submission (line 258) | `_loadInsightData()` is called explicitly — picks up the new check-in for accuracy recalculation |
| App backgrounded → foregrounded | No listener — insight stays as-is until next initState |
| Daily timer / midnight crossover | None — if a user keeps the app open across midnight, the nudge does not auto-update |

**No GetX controller** holds insight state. It's local to the widget. Each rebuild of `UserHomeScreen` re-fetches on initState.

---

## D4. Data flow — old home

```
User opens BottomBarScreen
  ↓
BottomBarScreen builds UserHomeScreen
  ↓
UserHomeScreen.initState
  ↓
WidgetsBinding.addPostFrameCallback → _loadInsightData()
  ↓
  ├─ a) cycleRepo.getCycleData(token) → GET /users/cycle_data
  │     ↓ if dataProvided == 1 && lastPeriodDate != null
  │     CycleEngine.calculate(lastPeriodDate, cycleLength) → CycleInfo(cycleDay, phase)
  │
  ├─ b) InsightService.getTodayInsight(cycleInfo) → Insight (text + 4 pills)
  │     ↓ uses StaticInsights.nudges + PhaseConfig (energy/mood/craving/workout)
  │
  ├─ c) checkinRepo.getDailyCheckin(date=today) → bool hasCheckinToday
  ├─ d) checkinRepo.getDailyCheckinsWeek() → int checkinsThisWeek
  └─ e) checkinRepo.getDailyCheckinsRecent(limit=7) → AccuracyService.getRolling7DayAccuracy() → double? accuracy
  ↓
setState → 7 fields populated
  ↓
build() runs
  ↓
if (_insight != null) { InsightCard(cycleInfo, insight, accuracyPercent, onViewSessions, onAddCycleData) }
  ↓
InsightCard renders (Stateful, _expanded toggle for Read more)
```

**5 sequential API calls** before the card can render. No parallelization. No retry. No timeout. No optimistic render. Card waits for the worst-case API.

---

# PART E — QUALITY ASSESSMENT

## E1. Strengths

1. **Phase-aware tone calibration.** Each phase has a distinct "voice" — menstrual is permissive ("rest is productive"), follicular is energizing ("push yourself"), ovulatory is celebratory ("you are unstoppable"), luteal is supportive ("be kind to yourself"). The copy is well-written.
2. **Day-1 rituals.** The `Day N` titles in menstrual + ovulatory feel like intentional milestones, which is psychologically meaningful for cycle-tracking users.
3. **Structural extras.** Energy/mood/craving/workout pills give the user something tangible per day — a pseudo-prediction the user can match against their actual experience. The check-in flow even saves `predictedEnergy` and `predictedMood` so accuracy can be measured.
4. **Pure & testable.** All logic is static, deterministic, and side-effect free. Every method takes inputs and returns outputs. Zero DB reads inside InsightService.
5. **Tolerant of bad input.** Unknown phase, day=0, day>length all hit fallbacks instead of throwing. The UI never crashes on weird state.
6. **Accuracy positive framing.** The `if (accuracy < 0.60) return null` rule prevents a user from ever seeing a depressing "Confidence: 32%" — they just see no badge.

## E2. Weaknesses

1. **Same nudge for multiple consecutive days.** Follicular 7–8, 9–10, 11–12 each repeat. Luteal 17–18, 19–21, 22–23, 24–25, 26–28 each repeat (one is 3 days long). See E3 for the full count.
2. **Static across all users.** Two users in the same phase + day see the exact same text. Same hour, same UI, same words. No personalization — not by name, not by goal, not by history, not by past compliance.
3. **22 templates total.** A user opening the app daily for a year will see each phase-aware template ~13 times.
4. **Body length forces "Read more" inconsistently.** 11 of 18 cycle-aware bodies are >120 chars and get clamped on the OLD card. On V2 nothing is clamped. Different visual rhythm depending on which screen the user is on.
5. **Workout pill data exists in the model but is never rendered.** `Insight.workout` carries intensity + bestTypes + avoid lists, but `_buildPillsRow` ignores it. Dead data path.
6. **Phase boundaries don't match nudge boundaries for non-28 cycles.** A user with cycle length 35 has phase boundaries at days 6/16/20, but nudge templates are written for 28. A `cycleDay = 33, phase = luteal` user falls into `_getNudge`'s last-template fallback and sees "Almost there" for ~7 days straight.
7. **5 sequential API calls** on home open (see D4). On a slow network the card flashes empty for several seconds.
8. **Non-28 cycles silently degrade.** Some users will get nudges that are wildly off-day (e.g. a 21-day cycle user in luteal day 13 gets `Gentle shift` even though her period is in 2 days, because that's the first luteal template).
9. **No tests.** Zero coverage. `lib/test/` only contains the default `widget_test.dart`. Nudge content can be edited without any safety net.
10. **No telemetry.** No analytics on which nudges users see or interact with. No way to A/B test copy.

## E3. 28-day simulation — what a user actually sees

Walking through `cycleDay 1..28` and recording what `_getNudge(phase, day)` returns:

| Day | Phase | Nudge title shown | Same as previous day? |
|---:|---|---|:---:|
| 1 | menstrual | Day 1 - Take it easy | — |
| 2 | menstrual | Day 2 - Rest is productive | new |
| 3 | menstrual | Day 3 - Slow and steady | new |
| 4 | menstrual | Day 4 - The shift begins | new |
| 5 | menstrual | Day 5 - Almost through | new |
| 6 | follicular | Day 6 - Energy is back | new |
| 7 | follicular | Rising energy | new |
| 8 | follicular | Rising energy | **REPEAT** |
| 9 | follicular | Momentum week | new |
| 10 | follicular | Momentum week | **REPEAT** |
| 11 | follicular | Peak building | new |
| 12 | follicular | Peak building | **REPEAT** |
| 13 | follicular | Tomorrow is peak | new |
| 14 | ovulatory | Day 14 - Peak energy | new |
| 15 | ovulatory | Still at the top | new |
| 16 | ovulatory | Last day of peak | new |
| 17 | luteal | Gentle shift | new |
| 18 | luteal | Gentle shift | **REPEAT** |
| 19 | luteal | Mid-luteal | new |
| 20 | luteal | Mid-luteal | **REPEAT** |
| 21 | luteal | Mid-luteal | **REPEAT (3rd day)** |
| 22 | luteal | Cravings may appear | new |
| 23 | luteal | Cravings may appear | **REPEAT** |
| 24 | luteal | Winding down | new |
| 25 | luteal | Winding down | **REPEAT** |
| 26 | luteal | Almost there | new |
| 27 | luteal | Almost there | **REPEAT** |
| 28 | luteal | Almost there | **REPEAT (3rd day)** |

| Metric | Count |
|---|---:|
| Unique nudges seen across 28 days | **18** |
| Days where nudge is the same as the previous day | **10** |
| Repeat-day rate | **35.7%** |
| Longest streak of identical text | **3 days** (luteal 19–21 and luteal 26–28) |

In the 12-day luteal phase, the user sees 5 unique nudges. **7 of those 12 days are visual repeats.** Late luteal especially: days 19–21 are identical, days 26–28 are identical.

If the user has cycle length ≠ 28, late-cycle days fall into `templates.last` indefinitely, which **could mean 5+ consecutive identical days** of `Almost there` for a user with a 33-day cycle.

## E4. Compared to a flat "4 phase-static nudges" approach

| Approach | Unique copy per cycle | Implementation cost | Marketing-claim risk |
|---|---:|---|---|
| Backend `StaticInsights.js` (current System A) | 4 (one per phase) | 27 lines | "AI" claim is hard to defend |
| Flutter `StaticInsights` + `InsightService` (System B, this audit) | 18 cycle-aware + 4 generic | ~340 lines across 4 files | "AI" claim is also hard to defend (same — it's a lookup table, just bigger) |
| Real LLM call (e.g. Sonnet API per request) | Effectively unbounded | New backend endpoint + cost per request | Defensible "AI" claim |

**Honest verdict.** System B is **4.5× more nudges** than System A. That's a real improvement over a single line per phase. But it's still a lookup table, not intelligence. The 28-day repeat-rate (35.7%) means a daily user notices the static-ness within one cycle.

**Both A and B should be marketed as "phase-based tips" or "cycle-aware nudges", not "AI insights".** Calling either one "AI" overpromises. The InsightService logic — phase boundaries, day-range matching, late-cycle fallback — is sophisticated *as code*. It is not sophisticated *as content delivery*.

---

# PART F — SECURITY & EDGE CASES

## F1. Edge case behavior

| Scenario | Behavior | Notes |
|---|---|---|
| `cycleInfo == null` | `_getGenericInsight()` → text-only Insight (one of 4 generics by day-of-year) | Card shows "Welcome back" header, no pills, "Add cycle data" CTA |
| `cycleInfo.phase` is unknown string (e.g. `"summer"`) | `_getNudge` returns `null`. Insight gets default title `"Your daily insight"` and body `"Listen to your body and move at your own pace."`. All 4 pill lookups also return `null`. | Card renders without pills. Header still shows `Day N of your cycle • Summer Phase` (Title-cased blindly). |
| `cycleDay = 0` (impossible from CycleEngine) | `_getNudge` linear-scan finds nothing → falls to `templates.last`. So a menstrual `cycleDay = 0` user sees `Day 5 - Almost through`. | Wrong nudge for the user, but no crash. |
| `cycleDay = -1` | Same as above — fallback to `templates.last`. | Phase determination is also broken for negative days (CycleEngine would never produce them, but defense-in-depth fails). |
| `cycleDay > averageCycleLength` (late period) | CycleEngine sets `cycleDay = daysSince + 1`, phase stays `luteal`. `_getNudge` linear-scan misses, falls back to last luteal template (`Almost there`). | Indefinite "Almost there" until user logs new period. |
| `cycleDay = 14, phase = ovulatory` (peak day) | Returns the dedicated `Day 14 - Peak energy` template. ✓ | Correct. |
| `dayOfYear = 364` (Dec 31) → `364 % 4 = 0` (A); `dayOfYear = 0` (Jan 1) → `0 % 4 = 0` (A) | Generic nudge "skips" — user sees nudge A two days in a row across the year boundary on a non-leap year. | Cosmetic, never observed because users with cycle data never hit the generic path. |
| Multiple app opens same day | **Same nudge every time.** No randomness, no time-of-day variance. | Predictable. |
| Cross-timezone user | `dayOfYear` uses local `DateTime.now()`. Cycle data uses local `lastPeriodDate` parsed from `YYYY-MM-DD` string (no TZ info → local midnight). A user crossing timezones during a flight could see day shift forward or backward by 1. | Same bug as backend `CyclePhaseCalculator`. Acknowledged. |
| Body string > 120 chars | OLD card adds Read more / Show less toggle. V2 card just lets it wrap. | Inconsistent UX between the two screens. |
| `accuracyPercent < 60%` | `getRolling7DayAccuracy` returns `null` → header shows no Confidence badge. | "Positive framing" — bad numbers hidden. |
| `< 3 valid check-ins in last 7 days` | Same — accuracy null → no badge. | Reasonable. |
| Network failure on cycle data fetch | `cycleResponse.body` checks fail → `cycleInfo = null` → generic insight path. | Card still renders with a generic nudge. Doesn't blow up. |
| Network failure on check-ins fetch | `accuracyPercent` stays null, `checkinsThisWeek` stays 0, `_showCheckinPrompt` stays false. | Card still renders correctly. Silently degrades. |

## F2. Test coverage

```
lib/test/
└── widget_test.dart   ← only the default Flutter counter-app test, no app-specific assertions
```

**Zero tests for:** `InsightService`, `StaticInsights`, `PhaseConfig`, `CycleEngine`, `AccuracyService`, `ProgressService`, `InsightCard`.

The static lookup tables in `static_insights.dart` and `phase_config.dart` could be silently corrupted by an editor (e.g., copy-paste error mangling a `dayEnd` value) and shipped to production with no detection. This is a low-likelihood but high-impact risk for a customer-facing system.

---

# PART G — Recommendation for the founder

The original prompt enumerated four options:
- **(a)** integrate into V2 paid home as-is
- **(b)** extract content from it and rebuild simpler
- **(c)** port it to backend
- **(d)** abandon it entirely

### Recommendation: **(b) Extract content, rebuild simpler — and keep the door open for (c)**

**Why (b)**
1. **The 18 nudges are real, well-written content.** Throwing them away (option d) loses copywriting hours that already happened.
2. **The orchestration code is over-engineered for what it actually delivers.** A 28-day cycle producing 18 unique nudges with a 35.7% repeat rate doesn't need 4 separate Dart files + a stateful widget. A single map (cycleDay → {title, body}) with inline lookup gets the same result in <50 lines.
3. **The pills, confidence badge, and `accuracyPercent` chain are not load-bearing.** They're shown only on the OLD home, not on V2. PaidHomeV2 already lacks them and the visual is fine. So the moment you swap the OLD home for V2 (which you're planning to via the `useNewPaidHome` flag), all the pill/accuracy machinery becomes dead code anyway.
4. **The CycleInfo class duplication is a smell.** Two classes named `CycleInfo` in the same project is a refactor magnet. An "extract content, drop the orchestrator" pass eliminates one of them.

**Concretely, what (b) looks like**
- Move the 18 cycle-aware nudges into either: (i) the existing `partner_backend/helper/StaticInsights.js` as a `nudgesByCycleDay` table, indexed by phase + day; or (ii) a single new Flutter file `lib/data/cycle_nudges.dart` keyed by cycleDay.
- Drop `accuracy_service.dart`, `progress_service.dart`, `phase_config.dart` from the V2 critical path. They can stay in the old screen until that screen is retired, then deleted.
- The "hybrid" plan from the previous turn (System A on transition days, System B otherwise) becomes unnecessary because there's only one system.

**Why keep (c) on the table**
If you go (b) and put the nudges *in the backend*, you get:
- Single source of truth — no Flutter/backend drift.
- Editable without app release (CMS-style copy updates).
- Easier path to swap in a real LLM call later behind the existing `source` field.

The cost is one more API field on `dashboard.insight` and a backend deploy — both small.

**Why NOT (a) integrate as-is**
- It would make `dashboard.insight` redundant and we'd carry two parallel insight systems forever.
- The pills + confidence badge would have to be ported to V2 to justify the integration, which contradicts the H-44 design spec.

**Why NOT (d) abandon**
- The content is genuinely usable. Throwing it away is wasteful.

---

## Files referenced in this audit

| File | Lines | Purpose |
|---|---:|---|
| `lib/data/static_insights.dart` | 179 | 18 cycle-aware + 4 generic nudge templates |
| `lib/data/services/insight_service.dart` | 119 | Orchestrator: phase + day → Insight (text + 4 pills) |
| `lib/data/services/accuracy_service.dart` | 68 | Rolling 7-day accuracy from check-ins |
| `lib/data/services/progress_service.dart` | 65 | Weekly + monthly check-in counts (used elsewhere) |
| `lib/data/phase_config.dart` | 171 | Energy/mood/craving/workout lookup tables |
| `lib/data/services/cycle_engine.dart` | 72 | cycleDay + phase math |
| `lib/widgets/insight_card.dart` | 277 | OLD home insight card (Stateful, white, expandable) |
| `lib/widgets/user_home_screen.dart` lines 90–280 | — | Single InsightService callsite + data loading |
| `lib/widgets/paid_home_v2/paid_insight_card.dart` | 128 | V2 insight card (Stateless, dark green, no pills/confidence) — for comparison only |
| `lib/data/models/home_dashboard/home_dashboard_model.dart` lines 79–104, 199–211 | — | Two CycleInfo and Insight classes, parsed from API |

End of audit.
