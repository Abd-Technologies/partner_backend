// Phase A — Progress Screen rebuild.
//
// Pure JSON-driven lookup. Returns the phase-aware nutrition tip + macro
// emphasis for the hydration card's footer. Intentionally NOT an LLM —
// these are short, validated copy strings.
//
// Phases match the rest of the codebase: 'menstrual' | 'follicular' |
// 'ovulatory' | 'luteal'. Brief v1 used 'ovulation'; CyclePhaseCalculator
// emits 'ovulatory'. We accept either to be tolerant of upstream drift.

const TIPS = {
  menstrual: {
    tip: 'Iron-rich foods support replenishment.',
    macroEmphasis: 'iron',
  },
  follicular: {
    tip: 'Aim for 100g protein — absorption is up to 30% higher in this phase.',
    macroEmphasis: 'protein',
  },
  ovulatory: {
    tip: 'Antioxidant-rich greens support egg quality.',
    macroEmphasis: 'fibre',
  },
  luteal: {
    tip: 'Magnesium-rich foods can ease cramp severity.',
    macroEmphasis: 'magnesium',
  },
};

const FALLBACK = {
  tip: 'Stay hydrated and balanced — small consistent meals help most.',
  macroEmphasis: 'balanced',
};

const PHASE_ALIASES = {
  ovulation: 'ovulatory',
};

/**
 * @param {string|null|undefined} phase
 * @returns {{ phase: string|null, tip: string, macroEmphasis: string }}
 */
function getPhaseTip(phase) {
  if (!phase) {
    return { phase: null, tip: FALLBACK.tip, macroEmphasis: FALLBACK.macroEmphasis };
  }
  const lower = String(phase).toLowerCase();
  const canonical = PHASE_ALIASES[lower] || lower;
  const entry = TIPS[canonical];
  if (!entry) {
    return { phase: null, tip: FALLBACK.tip, macroEmphasis: FALLBACK.macroEmphasis };
  }
  return { phase: canonical, tip: entry.tip, macroEmphasis: entry.macroEmphasis };
}

module.exports = {
  getPhaseTip,
  // Exposed for tests and for any controller that wants to do its own
  // overrides without re-defining the phases set.
  PHASES: Object.freeze(Object.keys(TIPS)),
};
