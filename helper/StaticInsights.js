// Per-(phase, cycleDay) insight lookup for PaidHomeScreenV2.
//
// Resolution order in getInsight(phase, cycleDay):
//   1. Cycle-aware: a template in CYCLE_NUDGES[phase] whose [dayStart, dayEnd]
//      contains cycleDay → returns that template's text + the phase accent.
//   2. Phase fallback: cycleDay didn't match any template (e.g. late period
//      with cycleDay > 28) → returns the FIRST template in CYCLE_NUDGES[phase]
//      so the user sees a coherent in-phase message instead of nothing.
//   3. Generic rotation: phase is unknown / null → returns one of four
//      generic nudges keyed by day-of-year mod 4 (UTC), with the follicular
//      accent as the visual default.
//   4. null: only reached if GENERIC_NUDGES is somehow empty. Caller (the
//      dashboard controller) tolerates a null insight by emitting `null` in
//      the response payload — the Flutter card handles that case.
//
// Content sourced from lib/data/static_insights.dart (Phase 5 work) with
// per-nudge title/body merged or dropped per the B2.9 content review:
// titles kept (8 nudges) when they add a calendar marker or cue not in the
// body; dropped (10 nudges) when they're section labels the body restates.

const PHASE_ACCENTS = {
  follicular: "#6DC55A",
  ovulatory: "#5ECFB0",
  luteal: "#FAC775",
  menstrual: "#FF8A8A",
};

const GENERIC_ACCENT = PHASE_ACCENTS.follicular;

const CYCLE_NUDGES = {
  menstrual: [
    {
      dayStart: 1,
      dayEnd: 1,
      text: "Day 1 - Take it easy. Your period just started. Low energy is completely normal. A gentle stretch or rest day is perfect. Listen to your body.",
    },
    {
      dayStart: 2,
      dayEnd: 2,
      text: "Day 2 - Rest is productive. Still early in your cycle. Energy stays low. Gentle yoga or stretching are ideal if you move at all.",
    },
    {
      dayStart: 3,
      dayEnd: 3,
      text: "Day 3 - Slow and steady. Energy starting to lift slightly. A light session could feel good, but no pressure. Your body is still recovering.",
    },
    {
      dayStart: 4,
      dayEnd: 4,
      text: "Day 4 - The shift begins. You may notice energy creeping back. A low-intensity session like Pilates could feel surprisingly good today.",
    },
    {
      dayStart: 5,
      dayEnd: 5,
      text: "Day 5 - Almost through. Your period is wrapping up. Energy is climbing. Tomorrow you will feel the difference. Today, keep it gentle.",
    },
  ],
  follicular: [
    {
      dayStart: 6,
      dayEnd: 6,
      text: "Day 6 - Energy is back. Estrogen is rising and you should feel it. Great day to get back into a rhythm. Strength or Cardio will feel right.",
    },
    {
      dayStart: 7,
      dayEnd: 8,
      text: "Your body is building momentum. This is the best window for challenging workouts.",
    },
    {
      dayStart: 9,
      dayEnd: 10,
      text: "Energy climbing steadily. You are in your power phase. High-intensity sessions will feel amazing this week.",
    },
    {
      dayStart: 11,
      dayEnd: 12,
      text: "Almost at your energy peak. Motivation should be high. Great time to try a new class or increase intensity.",
    },
    {
      dayStart: 13,
      dayEnd: 13,
      text: "Tomorrow is peak. Energy nearly at its highest. Fuel up, hydrate, get ready - tomorrow and the next few days are your power window.",
    },
  ],
  ovulatory: [
    {
      dayStart: 14,
      dayEnd: 14,
      text: "Day 14 - Peak energy. This is your peak. Energy, motivation, confidence all at highest. Go all out — try the most intense session you have planned.",
    },
    {
      dayStart: 15,
      dayEnd: 15,
      text: "Energy remains high. Social energy also peaking - a live group session will feel incredible. Feed off the community energy.",
    },
    {
      dayStart: 16,
      dayEnd: 16,
      text: "Last day of peak. Power window closing. Make the most of today. Tomorrow the shift begins - but today, you are unstoppable.",
    },
  ],
  luteal: [
    {
      dayStart: 17,
      dayEnd: 18,
      text: "Energy starts to ease. You may still feel strong, but do not push too hard. Power Yoga or Pilates are perfect.",
    },
    {
      dayStart: 19,
      dayEnd: 21,
      text: "Progesterone rising. You might feel more tired. That is normal. A moderate session will feel great without draining you.",
    },
    {
      dayStart: 22,
      dayEnd: 23,
      text: "Craving sugar or carbs? That is your hormones - not weakness. A gentle workout can actually help reduce cravings.",
    },
    {
      dayStart: 24,
      dayEnd: 25,
      text: "Energy low. Mood might dip. Hardest part of the cycle. Be kind to yourself. Gentle Yoga or Stretch is enough.",
    },
    {
      dayStart: 26,
      dayEnd: 28,
      text: "Almost there. Period approaching. Energy and mood at lowest. Rest is a valid choice. If you move, keep it gentle. Better days coming.",
    },
  ],
};

const GENERIC_NUDGES = [
  "Ready to move today? Check out today's sessions and find one that fits your energy. Add cycle data for personalized insights.",
  "Some days are high energy, some are not. Listen to your body and pick the right session. Cycle tracking makes this more accurate.",
  "The best workout is the one you show up for. Browse today's schedule and find your moment.",
  "Today's sessions are filling up. Join the community and get moving. Your body will thank you.",
];

// Day-of-year (UTC, 0-indexed) so the generic rotation rolls over at UTC
// midnight consistently across all servers. Same TZ choice as the rest of
// the dashboard date math (CyclePhaseCalculator uses Date.UTC too).
function dayOfYearUtc(now = new Date()) {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - start) / 86400000);
}

function getInsight(phase, cycleDay) {
  const templates = phase ? CYCLE_NUDGES[phase] : null;

  // 1. Cycle-aware match
  if (templates && Number.isInteger(cycleDay)) {
    for (const t of templates) {
      if (cycleDay >= t.dayStart && cycleDay <= t.dayEnd) {
        return { text: t.text, accentHex: PHASE_ACCENTS[phase] };
      }
    }
  }

  // 2. Phase fallback (cycleDay outside any template, e.g. late period)
  if (templates && templates.length > 0) {
    return { text: templates[0].text, accentHex: PHASE_ACCENTS[phase] };
  }

  // 3. Generic rotation
  if (GENERIC_NUDGES.length > 0) {
    const idx = dayOfYearUtc() % GENERIC_NUDGES.length;
    return { text: GENERIC_NUDGES[idx], accentHex: GENERIC_ACCENT };
  }

  // 4. Theoretical empty-table case — caller emits a null insight.
  return null;
}

module.exports = { getInsight };
