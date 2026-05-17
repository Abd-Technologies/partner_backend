const aiClient = require('./aiClient');
const { buildDietPlanPrompt } = require('./prompts/dietPlanPrompt');
const { buildDietPlanSchema } = require('./schemas/dietPlanSchema');
const { validateDietPlan } = require('./validators/dietPlanValidator');
const db = require('../../models');

const MODEL_NAME = process.env.GCP_AI_MODEL || 'gemini-2.5-flash';

/**
 * Pull token-usage numbers from the Gemini response in a defensive way.
 * The shape of `usageMetadata` has shifted across SDK versions and is
 * sometimes absent on streamed responses, so any one missing field
 * shouldn't break logging.
 */
function extractTokenUsage(response) {
  const u =
    (response && response.usageMetadata) ||
    (response && response.response && response.response.usageMetadata) ||
    null;
  if (!u) return { tokensInput: null, tokensOutput: null };
  return {
    tokensInput: u.promptTokenCount ?? u.inputTokenCount ?? null,
    tokensOutput: u.candidatesTokenCount ?? u.outputTokenCount ?? null,
  };
}

/**
 * Generate a personalised diet plan via Vertex AI Gemini.
 *
 * Always logs the attempt to AIGenerationLog (success or failure) so we
 * have an audit trail for billing, debugging, and prompt-engineering
 * iteration. The function never throws — failures are returned in the
 * result object so callers don't need their own try/catch.
 *
 * @param {object}      user         User profile — see dietPlanPrompt.js for shape.
 * @param {number}      [planDays=7] Days to generate.
 * @param {number|null} [dietitianId=null] Caller's user id (the dietitian);
 *                                          null when self-generated.
 * @returns {Promise<{
 *   success: boolean,
 *   plan?: object,
 *   validation?: { valid: boolean, errors: string[] },
 *   latencyMs: number,
 *   tokensUsed?: { tokensInput: number|null, tokensOutput: number|null },
 *   error?: string,
 * }>}
 */
async function generateDietPlan(user, planDays = 7, dietitianId = null) {
  const startedAt = Date.now();
  let prompt = '';
  let rawResponse = null;
  let validation = null;
  let plan = null;
  let tokensUsed = { tokensInput: null, tokensOutput: null };
  let success = false;
  let errorMessage = null;

  try {
    prompt = buildDietPlanPrompt(user, planDays);
    const schema = buildDietPlanSchema(planDays, user.mealsPerDay);

    const response = await aiClient.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema,
      },
    });

    rawResponse = response.text;
    tokensUsed = extractTokenUsage(response);

    plan = JSON.parse(rawResponse);
    validation = validateDietPlan(plan, user, planDays);

    if (!validation.valid) {
      errorMessage = `validation failed: ${validation.errors.join('; ')}`;
    } else {
      success = true;
    }
  } catch (err) {
    errorMessage = err && err.message ? err.message : String(err);
  }

  const latencyMs = Date.now() - startedAt;

  // Always log — even on failure. Logging itself must not throw.
  // We capture the row's id so callers (Phase C dietPlanService) can
  // link DietPlan.aiGenerationLogId back to the audit trail.
  let aiGenerationLogId = null;
  try {
    if (db.AIGenerationLog) {
      const logRow = await db.AIGenerationLog.create({
        userId: user && user.id ? user.id : null,
        dietitianId: dietitianId,
        model: MODEL_NAME,
        planDays,
        mealsPerDay: user && user.mealsPerDay,
        success,
        inputPrompt: prompt,
        rawResponse: rawResponse,
        validationErrors:
          validation && validation.errors && validation.errors.length
            ? JSON.stringify(validation.errors)
            : null,
        errorMessage: errorMessage,
        latencyMs,
        tokensInput: tokensUsed.tokensInput,
        tokensOutput: tokensUsed.tokensOutput,
      });
      aiGenerationLogId = logRow ? logRow.id : null;
    }
  } catch (logErr) {
    console.error('[aiDietPlanGenerator] failed to write AIGenerationLog:', logErr.message);
  }

  if (success) {
    return {
      success: true,
      plan,
      validation,
      latencyMs,
      tokensUsed,
      aiGenerationLogId,
    };
  }
  return {
    success: false,
    error: errorMessage || 'unknown error',
    validation: validation || undefined,
    latencyMs,
    aiGenerationLogId,
  };
}

module.exports = { generateDietPlan };
