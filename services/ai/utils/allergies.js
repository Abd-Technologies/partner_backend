/**
 * Turn a client's freeform `allergies` text (comma-separated, typed by
 * the client or the dietitian on the pre-consultation form) into a
 * clean list of real keywords.
 *
 * Shared by dietPlanPrompt.js (what we tell Gemini to avoid) and
 * dietPlanValidator.js (what we check the response against) so the two
 * can never drift apart — a keyword filtered here is filtered for both.
 *
 * Drops anything under 3 characters. No real allergen name is 1-2
 * characters; a fragment that short is always test/placeholder junk or
 * a stray comma artifact (e.g. someone typing "g" into the field). Left
 * unfiltered, a single-letter "allergy" gets treated as a literal
 * ingredient to avoid — Gemini was seen instructing itself to strictly
 * avoid "any foods containing the letter 'g'" in a plan summary, and
 * dietPlanValidator.js flagged nearly every meal as an "allergy
 * violation" for the same reason.
 *
 * @param {string|null|undefined} raw
 * @returns {string[]} lowercase, trimmed, deduplicated keywords
 */
function parseAllergyKeywords(raw) {
  const seen = new Set();
  for (const part of (raw || '').split(',')) {
    const kw = part.trim().toLowerCase();
    if (kw.length >= 3) seen.add(kw);
  }
  return [...seen];
}

module.exports = { parseAllergyKeywords };
