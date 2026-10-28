// Trial-to-Plan funnel — Steps 3, 4, 5:
//   3. Quick nutrition intake (her full pre-consultation answers are
//      saved step by step from the app; this call confirms them).
//   4. Auto-generate a starter plan via the same AI service the
//      dietitian's admin flow uses (services/ai/aiDietPlanGenerator.js),
//      but server-triggered: dietitianId is null throughout.
//   5. Auto-activate immediately — no dietitian review step for the
//      trial's starter plan.
//
// Oct 2026: the AI can be slow or fail on the live server, so she never
// waits more than WAIT_MS (6 s) on the "making your plan" screen:
//   - ready within 6 s  -> answered with the plan, exactly as before
//                          (no push).
//   - not ready in 6 s  -> answered { pending: true } ("Your plan will be
//                          shared soon"); the plan keeps being made in the
//                          background and she gets ONE push when it is
//                          ready ("Your starter plan is ready 🌱"). That
//                          push ignores quiet hours: she asked for it.
//   - AI fails          -> retried quietly after 1, 5 and 15 minutes; a
//                          5-minute cron (retryPendingTrialPlans) also
//                          picks up anything lost in a server restart.
//
// One-shot by design: a trial user who already has a DietPlan doesn't get
// a second one from this endpoint.
const ApiResponse = require('../../helper/ApiResponse');
const db = require('../../models');
const { generateDietPlan } = require('../../services/ai/aiDietPlanGenerator');
const {
  saveDraftDietPlan,
  activateDietPlan,
} = require('../../services/dietPlanService');
const { ensureTrialUserPlan } = require('../../services/trialPlanService');
const { computeTargetCalories, heightFeetToCm } = require('../../services/ai/utils/calorieTarget');

const { User, PreConsultationProfile, DietPlan, TrialJourney } = db;

const DEFAULT_TRIAL_MEALS_PER_DAY = 4;
const { getTrialDays } = require('../../helper/trialState');
const VALID_MEALS_PER_DAY = [3, 4, 5, 6];

// Longest she waits on the "making your plan" screen.
const WAIT_MS = 6000;
// Quiet retries after a failed AI call (minutes).
const RETRY_MINUTES = [1, 5, 15];
// Cron safety net: give up after this many attempts in total.
const MAX_ATTEMPTS = 6;

// MariaDB hands JSON columns back as strings; parse defensively.
function asJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

// ── Background generation ───────────────────────────────────────────────

// userId -> Promise of the activated plan (one job per woman at a time).
const inflight = new Map();
// userId -> attempts made (in this server process).
const attempts = new Map();
// userIds whose app already moved on ("shared soon"): they get the push.
const waitingForPush = new Set();

let redis = null;
function getRedis() {
  if (redis) return redis;
  try {
    const Redis = require('ioredis');
    redis = new Redis();
    redis.on('error', () => {});
  } catch (e) {
    redis = null;
  }
  return redis;
}

async function markWaiting(userId) {
  waitingForPush.add(userId);
  try {
    const r = getRedis();
    if (r) await r.set(`trialplan:waiting:${userId}`, '1', 'EX', 60 * 60 * 24 * 3);
  } catch (_) {}
}

async function isWaiting(userId) {
  if (waitingForPush.has(userId)) return true;
  try {
    const r = getRedis();
    if (r) return (await r.get(`trialplan:waiting:${userId}`)) === '1';
  } catch (_) {}
  return false;
}

/** Clears the flag; true only for the ONE caller that cleared it (so two
 *  finishing paths can never send the push twice). */
async function takeWaiting(userId) {
  let had = waitingForPush.delete(userId);
  try {
    const r = getRedis();
    if (r) had = (await r.del(`trialplan:waiting:${userId}`)) === 1 || had;
  } catch (_) {}
  return had;
}

// ── Job state, for the team (Oct 2026) ──────────────────────────────────
// Redis trialplan:state:<userId> = { since, attempts, lastError, failedAt }
// Read by the admin portal list "Plans waiting / failed".
const ALERT_AFTER_FAILS = 3;
const ALERT_AFTER_MINUTES = 10;
const AUTH_ERROR = /invalid_grant|invalid_rapt|reauth|credential|unauthenticated|permission denied|401|403/i;
const memState = new Map();

async function getState(userId) {
  try {
    const r = getRedis();
    if (r) {
      const raw = await r.get(`trialplan:state:${userId}`);
      if (raw) return JSON.parse(raw);
      return null;
    }
  } catch (_) {}
  return memState.get(userId) || null;
}

async function setState(userId, st) {
  memState.set(userId, st);
  try {
    const r = getRedis();
    if (r) await r.set(`trialplan:state:${userId}`, JSON.stringify(st), 'EX', 60 * 60 * 24 * 14);
  } catch (_) {}
}

async function clearState(userId) {
  memState.delete(userId);
  try {
    const r = getRedis();
    if (r) await r.del(`trialplan:state:${userId}`);
  } catch (_) {}
}

async function userLabel(userId) {
  try {
    const u = await User.findByPk(userId, { attributes: ['firstName', 'lastName', 'email'] });
    if (!u) return `user ${userId}`;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return `${name || 'A client'} (id ${userId})`;
  } catch (_) {
    return `user ${userId}`;
  }
}

/** A failed attempt: remember it, and tell the team when it matters. */
async function noteFailure(userId, err) {
  const msg = String((err && err.message) || err || 'unknown error').slice(0, 300);
  const st = (await getState(userId)) || { since: Date.now(), attempts: 0 };
  st.attempts = (st.attempts || 0) + 1;
  st.lastError = msg;
  st.failedAt = Date.now();
  await setState(userId, st);
  const { opsAlert } = require('../../helper/opsAlert');
  if (AUTH_ERROR.test(msg)) {
    // Every plan will fail until this is fixed: alert at once (once an hour).
    await opsAlert(
      'ai_auth',
      'AI plans are failing: Google login problem',
      `The server can't log in to Google AI (${msg.slice(0, 120)}). No starter plans can be made until this is fixed. Use a service account key on the server.`,
      { everyMinutes: 60 }
    );
  }
  if (st.attempts >= ALERT_AFTER_FAILS) {
    const who = await userLabel(userId);
    await opsAlert(
      `trialplan_fail_${userId}`,
      'A starter plan failed 3 times',
      `${who}: her trial starter plan could not be made (${st.attempts} tries). Last error: ${msg.slice(0, 120)}. Open Plans waiting / failed to retry.`,
      { everyMinutes: 60 * 24 }
    );
  }
}

/** Builds the AI input from her saved answers, generates and activates. */
async function buildAndActivate(userId) {
  // Someone (another request / the cron) may have made it meanwhile.
  const existing = await DietPlan.findOne({ where: { userId } });
  if (existing) return existing;

  const user = await User.findByPk(userId);
  if (!user) throw new Error('User not found');
  const profile = await PreConsultationProfile.findOne({ where: { userId } });
  if (!profile || !profile.goals) throw new Error('No intake saved');
  const trialUserPlan = await ensureTrialUserPlan(userId);

  const savedMeals = Number(profile.mealsPerDay);
  const resolvedMealsPerDay = VALID_MEALS_PER_DAY.includes(savedMeals)
    ? savedMeals
    : DEFAULT_TRIAL_MEALS_PER_DAY;

  const userInput = {
    id: user.id,
    firstName: user.firstName || 'User',
    age: user.age,
    // heightFeetToCm() converts User.height (stored as decimal FEET,
    // e.g. "5.4" = 5.4 ft — legacy schema) to real centimeters.
    weightKg: user.weight,
    heightCm: heightFeetToCm(user.height),
    goal: profile.goals,
    cyclePhase: 'follicular',
    hasPcos: ((profile.medicalConditions || '') + ' ' + (user.healthConditions || ''))
      .toLowerCase()
      .includes('pcos'),
    allergies: profile.allergies || '',
    cuisinePreference: 'Pakistani',
    targetCalories: computeTargetCalories({
      weightKg: user.weight,
      heightCm: heightFeetToCm(user.height),
      age: user.age,
      lifestyle: profile.lifestyle,
      goalKey: profile.goals,
    }),
    mealsPerDay: resolvedMealsPerDay,
    // Rest of the full form, same as the dietitian flow.
    pregnancyMenstrualStatus: profile.pregnancyMenstrualStatus || '',
    medicalConditions: profile.medicalConditions || '',
    currentMedications: profile.currentMedications || '',
    dietaryPreferences: asJson(profile.dietaryPreferences, []),
    fastingHabits: profile.fastingHabits || '',
    surgeries: profile.surgeries || '',
    familyHistory: profile.familyHistory || '',
    lifestyle: asJson(profile.lifestyle, {}),
    dietitianNotes: [],
  };

  // The starter plan covers exactly the trial (admin's trial length).
  const TRIAL_PLAN_DAYS = getTrialDays();
  const result = await generateDietPlan(userInput, TRIAL_PLAN_DAYS, null);
  if (!result.success) {
    // "invalid_grant" here means the server's Google (Vertex AI) login
    // has expired: use a service account in production.
    const err = new Error(String(result.error || 'AI generation failed'));
    err.validation = result.validation || null;
    throw err;
  }

  // Made while we waited? Don't save a second one.
  const again = await DietPlan.findOne({ where: { userId } });
  if (again) return again;

  const draft = await saveDraftDietPlan({
    userId,
    userPlanId: trialUserPlan.id,
    dietitianId: null,
    aiResult: result.plan,
    planDays: TRIAL_PLAN_DAYS,
    mealsPerDay: resolvedMealsPerDay,
    aiGenerationLogId: result.aiGenerationLogId,
  });
  return activateDietPlan(draft.id, null);
}

/** "Your starter plan is ready 🌱" — only if her app already moved on. */
async function pushReady(userId) {
  if (!(await takeWaiting(userId))) return;
  try {
    const user = await User.findByPk(userId, { attributes: ['deviceToken'] });
    if (!user || !user.deviceToken) return;
    const sendNotification = require('../../helper/notification');
    await sendNotification(
      [user.deviceToken],
      {
        title: 'Your starter plan is ready 🌱',
        body: 'Your meals for today are waiting. Open Fit Her to see them.',
      },
      // Ignores quiet hours (helper/notification.js IGNORE_QUIET): she
      // asked for this plan and is waiting for it.
      { type: 'trialPlanReady' }
    );
  } catch (e) {
    console.error('[trial-plan] ready push', userId, e.message);
  }
}

/**
 * Starts (or joins) the background job for her plan. Resolves with the
 * activated plan; on failure schedules the next quiet retry and rejects.
 */
function startPlanJob(userId) {
  if (inflight.has(userId)) return inflight.get(userId);
  const n = (attempts.get(userId) || 0) + 1;
  attempts.set(userId, n);
  const job = (async () => {
    // First attempt: remember when she started waiting.
    if (!(await getState(userId))) await setState(userId, { since: Date.now(), attempts: 0 });
    return buildAndActivate(userId);
  })()
    .then(async (plan) => {
      attempts.delete(userId);
      await clearState(userId);
      await pushReady(userId);
      return plan;
    })
    .catch(async (err) => {
      console.error(`[trial-plan] user ${userId} attempt ${n} failed:`, err.message);
      try {
        await noteFailure(userId, err);
      } catch (_) {}
      const wait = RETRY_MINUTES[n - 1];
      if (wait != null) {
        setTimeout(() => {
          startPlanJob(userId).catch(() => {});
        }, wait * 60 * 1000);
      } else {
        console.error(`[trial-plan] user ${userId}: retries used up, cron will try again`);
      }
      throw err;
    })
    .finally(() => {
      inflight.delete(userId);
    });
  inflight.set(userId, job);
  return job;
}

/**
 * Every 5 minutes: trial women whose answers are saved but who still have
 * no plan (AI failed, or the server restarted mid-job). Only while the
 * trial is running and only for women whose app already moved on.
 */
async function retryPendingTrialPlans() {
  const { Op } = require('sequelize');
  const days = getTrialDays();
  const since = new Date(Date.now() - days * 86400000);
  const journeys = await TrialJourney.findAll({
    where: { startedAt: { [Op.gte]: since }, convertedAt: null },
    attributes: ['userId'],
  });
  let started = 0;
  for (const j of journeys) {
    const userId = j.userId;
    if (inflight.has(userId)) continue;
    if (!(await isWaiting(userId))) continue;
    const has = await DietPlan.findOne({ where: { userId }, attributes: ['id'] });
    if (has) {
      await pushReady(userId);
      continue;
    }
    // Waiting more than 10 minutes: tell the team (once a day per woman).
    const st = await getState(userId);
    if (st && st.since && Date.now() - st.since > ALERT_AFTER_MINUTES * 60000) {
      const { opsAlert } = require('../../helper/opsAlert');
      const mins = Math.round((Date.now() - st.since) / 60000);
      const who = await userLabel(userId);
      await opsAlert(
        `trialplan_slow_${userId}`,
        'A starter plan is taking too long',
        `${who} has been waiting ${mins} minutes for her trial starter plan.${st.lastError ? ' Last error: ' + String(st.lastError).slice(0, 120) + '.' : ''} Open Plans waiting / failed to retry.`,
        { everyMinutes: 60 * 24 }
      );
    }
    if ((attempts.get(userId) || 0) >= MAX_ATTEMPTS) continue;
    started++;
    startPlanJob(userId).catch(() => {});
  }
  return started;
}

// ── Admin portal: Plans waiting / failed (Oct 2026) ─────────────────────

/** Trial women whose answers are saved but who have no starter plan yet. */
async function listWaitingTrialPlans() {
  const { Op } = require('sequelize');
  const days = getTrialDays();
  const since = new Date(Date.now() - days * 86400000);
  const journeys = await TrialJourney.findAll({
    where: { startedAt: { [Op.gte]: since }, convertedAt: null },
    attributes: ['userId', 'startedAt'],
    order: [['startedAt', 'ASC']],
  });
  const out = [];
  for (const j of journeys) {
    const userId = j.userId;
    const has = await DietPlan.findOne({ where: { userId }, attributes: ['id'] });
    if (has) continue;
    const profile = await PreConsultationProfile.findOne({
      where: { userId },
      attributes: ['goals', 'intakeSource', 'isComplete'],
    });
    // Only women who finished the trial form (the plan was asked for).
    if (!profile || !profile.goals || !String(profile.intakeSource || '').startsWith('trial')) continue;
    const u = await User.findByPk(userId, {
      attributes: ['id', 'firstName', 'lastName', 'email', 'phone'],
    });
    const st = await getState(userId);
    const triesUsed = (st && st.attempts) || 0;
    out.push({
      userId,
      name: u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() : '',
      email: u ? u.email : null,
      phone: u ? u.phone || null : null,
      waitingSince: new Date((st && st.since) || j.startedAt),
      attempts: triesUsed,
      lastError: (st && st.lastError) || null,
      status: inflight.has(userId)
        ? 'making'
        : triesUsed >= ALERT_AFTER_FAILS
          ? 'failed'
          : triesUsed > 0
            ? 'retrying'
            : 'waiting',
    });
  }
  return out;
}

/** Admin "Retry": start again now; she gets the push when it's ready. */
async function retryTrialPlanNow(userId) {
  const has = await DietPlan.findOne({ where: { userId }, attributes: ['id'] });
  if (has) return { ok: true, already: true };
  attempts.delete(userId);
  await markWaiting(userId);
  startPlanJob(userId).catch(() => {});
  return { ok: true };
}

/** GET /admin/trial-plans/waiting */
async function adminListWaiting(req, res) {
  try {
    const items = await listWaitingTrialPlans();
    return res.json(ApiResponse('1', 'Plans waiting', { items }));
  } catch (err) {
    console.error('[trial-plan] admin list', err);
    return res.json(ApiResponse('0', 'Could not load', {}));
  }
}

/** POST /admin/trial-plans/:userId/retry */
async function adminRetry(req, res) {
  const userId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(userId)) return res.json(ApiResponse('0', 'Wrong client', {}));
  try {
    const r = await retryTrialPlanNow(userId);
    return res.json(
      ApiResponse('1', r.already ? 'She already has her plan' : 'Making her plan again', r)
    );
  } catch (err) {
    console.error('[trial-plan] admin retry', err);
    return res.json(ApiResponse('0', 'Could not retry', {}));
  }
}

/**
 * POST /trial/quick-intake
 * Body: { goal?, allergies?, mealsPerDay? } (older app versions)
 * Auth: validateToken (logged-in user)
 */
async function submitTrialQuickIntake(req, res) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.json(ApiResponse('0', 'User not loggedIn!', {}));
    }

    // Must have actually started the (live-class) trial first — this
    // endpoint is the second step of that same funnel, not a standalone
    // "get a free plan" door.
    const journey = await TrialJourney.findOne({ where: { userId } });
    if (!journey) {
      return res.json(ApiResponse('0', 'Start your free trial first', {}));
    }

    // The trial uses the SAME full pre-consultation form as paid users
    // (saved step by step through PATCH /users/pre-consultation), so the
    // body here is usually empty. goal / allergies / mealsPerDay are
    // still honoured for older app versions using the 3-field screen.
    const { goal, allergies, mealsPerDay } = req.body || {};
    const existingProfile = await PreConsultationProfile.findOne({ where: { userId } });
    const resolvedGoal =
      (goal && String(goal).trim()) ||
      (existingProfile && existingProfile.goals) ||
      null;
    if (!resolvedGoal) {
      return res.json(ApiResponse('0', 'Please tell us your main goal', {}));
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.json(ApiResponse('0', 'User not found', {}));
    }

    // One-shot: a trial user who already has a plan doesn't get a second.
    const existingPlan = await DietPlan.findOne({ where: { userId } });
    if (existingPlan) {
      return res.json(
        ApiResponse('0', "You've already got a plan", {
          dietPlanId: existingPlan.id,
        })
      );
    }

    await ensureTrialUserPlan(userId);

    let profile = existingProfile;
    const savedMeals = profile ? Number(profile.mealsPerDay) : NaN;
    const resolvedMealsPerDay = VALID_MEALS_PER_DAY.includes(Number(mealsPerDay))
      ? Number(mealsPerDay)
      : VALID_MEALS_PER_DAY.includes(savedMeals)
        ? savedMeals
        : DEFAULT_TRIAL_MEALS_PER_DAY;

    const profileFields = {
      userId,
      goals: resolvedGoal,
      allergies:
        allergies != null && String(allergies).trim() !== ''
          ? String(allergies).trim()
          : (profile ? profile.allergies : null),
      mealsPerDay: resolvedMealsPerDay,
      // Filled during the free trial. When she later buys a package she
      // is asked to REVIEW and CONFIRM these answers instead of filling
      // the form again (see evalPreConsultationForm).
      intakeSource: 'trial',
      isComplete: true,
      lastUserUpdate: new Date(),
    };

    if (profile) {
      await profile.update(profileFields);
    } else {
      profile = await PreConsultationProfile.create(profileFields);
    }

    // Make the plan, waiting at most WAIT_MS for it.
    const PENDING = Symbol('pending');
    const job = startPlanJob(userId);
    let outcome;
    try {
      outcome = await Promise.race([
        job,
        new Promise((resolve) => setTimeout(() => resolve(PENDING), WAIT_MS)),
      ]);
    } catch (err) {
      // Failed fast: retries are already scheduled. She moves on.
      outcome = PENDING;
    }

    if (outcome !== PENDING) {
      return res.json(
        ApiResponse('1', 'Your simple plan is ready!', { dietPlan: outcome })
      );
    }

    // Not ready in time: she moves on, and gets one push when it's ready.
    await markWaiting(userId);
    // The job may have finished in the moment between: push now then.
    const ready = await DietPlan.findOne({ where: { userId }, attributes: ['id'] });
    if (ready) await pushReady(userId);
    return res.json(
      ApiResponse('1', 'Your plan will be shared soon', { pending: true })
    );
  } catch (err) {
    console.error('[submitTrialQuickIntake] error:', err);
    return res.status(500).json(ApiResponse('0', err.message, {}));
  }
}

module.exports = {
  submitTrialQuickIntake,
  retryPendingTrialPlans,
  adminListWaiting,
  adminRetry,
};
