// One weekly check-in (Oct 2026). See helper/weeklyCheckin.js for the
// rules. The app never decides the week or the sections: the server does.
//
// GET  /users/weekly-checkin/state        → stateFor(userId)
// POST /users/weekly-checkin              → save this week's check-in
// POST /users/weekly-checkin/measurements → "Log measurements" any time
// GET  /users/weekly-checkin/history      → Progress tab history
const ApiResponse = require("../../helper/ApiResponse");
const { createEscalation } = require("../../helper/escalation");
const { currentWeekMonday } = require("../../helper/dateUtils");
const { stateFor, historyFor, FEEL, FEEL_TO_SATISFACTION } = require("../../helper/weeklyCheckin");
const {
  WeeklyCheckin,
  Report,
  Day7Review,
  ProgressSubmission,
  PendingPopupState,
  UserPlan,
  Plan,
} = require("../../models");

const HUNGER = new Set(["always_hungry", "just_right", "too_full"]);
const DIFFICULTY = new Set(["too_easy", "just_right", "too_hard"]);
const CLOTHES = new Set(["tighter", "same", "looser"]);
const MEALS = new Set(["breakfast", "lunch", "dinner", "snacks", "none"]);
const SIDE_EFFECTS = new Set(["bloating", "headaches", "cravings", "other", "none"]);

function num(v, min, max) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!isFinite(n) || n < min || n > max) return undefined; // invalid
  return Math.round(n * 10) / 10;
}
const int15 = (v) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null);
const list = (v, allowed) => (Array.isArray(v) ? v.filter((x) => allowed.has(x)) : []);

async function retirePopup(userId, variable, metadata) {
  const open = await PendingPopupState.findOne({
    where: { userId, popupVariable: variable, completedAt: null },
    order: [["createdAt", "DESC"]],
  });
  if (open) await open.update({ completedAt: new Date() });
  else await PendingPopupState.create({ userId, popupVariable: variable, completedAt: new Date(), metadata });
}

function ddmmyyyy(d) {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
}

exports.getState = async (req, res) => {
  try {
    return res.json(ApiResponse("1", "Weekly check-in", await stateFor(req.user.id)));
  } catch (e) {
    console.error("[weekly-checkin] state:", e);
    return res.json(ApiResponse("0", "Couldn't load your check-in", {}));
  }
};

exports.save = async (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body || {};
    const state = await stateFor(userId);
    if (!state.checkinDay) {
      return res.json(ApiResponse("0", "Your first check-in isn't open yet", {}));
    }

    // ── Core: weight (required), measurements (optional), week feel ──
    const weightKg = num(b.weightKg, 20, 500);
    if (weightKg == null || weightKg === undefined) {
      return res.json(ApiResponse("0", "Please enter your weight (20 to 500 kg)", {}));
    }
    const m = {};
    for (const k of ["waistCm", "hipsCm", "chestCm", "armsCm", "thighsCm"]) {
      const v = num(b[k], 10, 300);
      if (v === undefined) return res.json(ApiResponse("0", "Please check your measurements", {}));
      m[k] = v;
    }
    const feel = Number(b.weekFeel);
    if (!FEEL[feel]) return res.json(ApiResponse("0", "Please tell us how your week was", {}));

    // ── Plan questions (only the sections the server asked for) ──
    let planAnswers = null;
    if (state.sections.diet || state.sections.workout) {
      planAnswers = {
        painReported: b.painReported === true,
        painLocation: b.painReported === true ? String(b.painLocation || "").slice(0, 255) : null,
        severeSideEffectsReported: b.severeSideEffectsReported === true,
      };
      if (state.sections.diet) {
        const adherence = Number(b.adherencePct);
        planAnswers.adherencePct = isFinite(adherence) ? Math.max(0, Math.min(100, Math.round(adherence))) : null;
        planAnswers.mealsStruggled = list(b.mealsStruggled, MEALS);
        planAnswers.hungerLevel = HUNGER.has(b.hungerLevel) ? b.hungerLevel : null;
        planAnswers.sideEffects = list(b.sideEffects, SIDE_EFFECTS);
      }
      if (state.sections.workout) {
        planAnswers.difficultyLevel = DIFFICULTY.has(b.difficultyLevel) ? b.difficultyLevel : null;
        planAnswers.sessionTimingIssues = b.sessionTimingIssues === true;
      }
    }

    // ── Halfway / end answers ──
    let milestoneAnswers = null;
    if (state.sections.milestone) {
      milestoneAnswers = {
        clothesFit: CLOTHES.has(b.clothesFit) ? b.clothesFit : null,
        sleepQuality: int15(b.sleepQuality),
        satisfaction: int15(b.satisfaction),
      };
    }

    // ── 1. The weekly record ──
    const weekDate = currentWeekMonday();
    const values = {
      weightKg,
      waistCm: m.waistCm,
      hipCm: m.hipsCm,
      chestCm: m.chestCm,
      armsCm: m.armsCm,
      thighsCm: m.thighsCm,
      weekRating: feel,
      userPlanId: state.userPlanId,
      checkinDay: state.checkinDay,
      planAnswers,
      milestoneAnswers,
    };
    const [row, created] = await WeeklyCheckin.findOrCreate({
      where: { userId, weekDate },
      defaults: { userId, weekDate, ...values },
    });
    if (!created) await row.update(values);

    // ── 2. Old weekly sheet (staff "user reports" + progress PDF) ──
    try {
      const start = state.start || {};
      await Report.create({
        userId,
        weight: start.weightKg != null ? String(start.weightKg) : String(weightKg),
        currentWeight: String(weightKg),
        weist: m.waistCm != null ? String(m.waistCm) : null,
        hips: m.hipsCm != null ? String(m.hipsCm) : null,
        chest: m.chestCm != null ? String(m.chestCm) : null,
        arms: m.armsCm != null ? String(m.armsCm) : null,
        thighs: m.thighsCm != null ? String(m.thighsCm) : null,
        istDayDate: start.date ? ddmmyyyy(start.date) : ddmmyyyy(new Date()),
        currentDate: ddmmyyyy(new Date()),
        review: FEEL[feel],
        status: 1,
      });
    } catch (e) {
      console.warn("[weekly-checkin] report copy failed:", e.message);
    }

    // ── 3. Plan answers → Day7Review (alerts to dietitian + admin) ──
    if (planAnswers) {
      try {
        const up = await UserPlan.findOne({
          where: { id: state.userPlanId, userId },
          include: [{ model: Plan, attributes: ["planType", "dietitianId"] }],
        });
        // Week 1 keeps the Day 7 review's cycle 1; later ones use the day.
        const cycle = state.checkinDay === 7 ? 1 : state.checkinDay;
        const review = await Day7Review.create({
          userId,
          userPlanId: state.userPlanId,
          cycle,
          planType: state.planType,
          ...planAnswers,
          satisfaction: FEEL_TO_SATISFACTION[feel],
        });
        if (review.flagged) {
          const { resolveDietitianId } = require("./day7ReviewController");
          const dietitianId = await resolveDietitianId(userId, up);
          await createEscalation({
            userId,
            dietitianId,
            trigger: "REVIEW_FLAG",
            severity: "high",
            payload: {
              reviewId: review.id,
              userPlanId: state.userPlanId,
              cycle,
              planType: state.planType,
              flagReasons: review.flagReasons,
              source: "weekly_checkin",
            },
          });
        }
        if (state.checkinDay === 7) await retirePopup(userId, "POPUP_DAY7_REVIEW", { reviewId: review.id, cycle });
      } catch (e) {
        console.error("[weekly-checkin] plan answers failed:", e);
      }
    }

    // ── 4. Halfway / end → ProgressSubmission (follow-up unlock, renew) ──
    let followupOpen = false;
    if (state.sections.milestone) {
      const cycle = state.sections.milestone === "halfway" ? 15 : 30;
      const fields = {
        userId,
        userPlanId: state.userPlanId,
        cycle,
        weightKg,
        waistCm: m.waistCm,
        hipsCm: m.hipsCm,
        chestCm: m.chestCm,
        armsCm: m.armsCm,
        thighsCm: m.thighsCm,
        ...milestoneAnswers,
        submittedAt: new Date(),
      };
      const [ps, made] = await ProgressSubmission.findOrCreate({
        where: { userPlanId: state.userPlanId, cycle },
        defaults: fields,
      });
      if (!made) await ps.update(fields);
      await retirePopup(userId, cycle === 15 ? "POPUP_DAY15_PROGRESS" : "POPUP_DAY30_PROGRESS", {
        progressSubmissionId: ps.id,
        cycle,
      });
      followupOpen = cycle === 15;
    }

    // Since she started (for the "Saved" screen).
    const startW = state.start && state.start.weightKg;
    const lastW = state.last && state.last.weightKg;
    return res.json(
      ApiResponse("1", "Check-in saved", {
        checkinDay: state.checkinDay,
        milestone: state.sections.milestone,
        endOfPackage: state.endOfPackage,
        followupOpen,
        changeThisWeek: lastW != null ? Math.round((weightKg - lastW) * 10) / 10 : null,
        changeSinceStart: startW != null ? Math.round((weightKg - startW) * 10) / 10 : null,
      })
    );
  } catch (e) {
    console.error("[weekly-checkin] save:", e);
    return res.json(ApiResponse("0", "Couldn't save your check-in. Please try again.", {}));
  }
};

// "Log measurements" (Profile › My reports, Home weight card) when no
// check-in is due. Same weekly record: this week's row is updated with
// whatever she filled in (empty fields keep what was there), plus the
// old weekly sheet copy for staff and the PDF. No questions.
exports.logMeasurements = async (req, res) => {
  try {
    const userId = req.user.id;
    const b = req.body || {};
    const weightKg = num(b.weightKg, 20, 500);
    if (weightKg === undefined) return res.json(ApiResponse("0", "Please check your weight (20 to 500 kg)", {}));
    const m = {};
    for (const k of ["waistCm", "hipsCm", "chestCm", "armsCm", "thighsCm"]) {
      const v = num(b[k], 10, 300);
      if (v === undefined) return res.json(ApiResponse("0", "Please check your measurements", {}));
      m[k] = v;
    }
    if (weightKg == null && Object.values(m).every((v) => v == null)) {
      return res.json(ApiResponse("0", "Please fill in at least one value", {}));
    }
    const values = {};
    if (weightKg != null) values.weightKg = weightKg;
    if (m.waistCm != null) values.waistCm = m.waistCm;
    if (m.hipsCm != null) values.hipCm = m.hipsCm;
    if (m.chestCm != null) values.chestCm = m.chestCm;
    if (m.armsCm != null) values.armsCm = m.armsCm;
    if (m.thighsCm != null) values.thighsCm = m.thighsCm;

    const state = await stateFor(userId);
    const weekDate = currentWeekMonday();
    const [row, created] = await WeeklyCheckin.findOrCreate({
      where: { userId, weekDate },
      defaults: { userId, weekDate, ...values },
    });
    if (!created) await row.update(values);

    try {
      const start = state.start || {};
      const str = (v) => (v != null ? String(v) : null);
      await Report.create({
        userId,
        weight: str(start.weightKg != null ? start.weightKg : row.weightKg),
        currentWeight: str(row.weightKg),
        weist: str(row.waistCm),
        hips: str(row.hipCm),
        chest: str(row.chestCm),
        arms: str(row.armsCm),
        thighs: str(row.thighsCm),
        istDayDate: start.date ? ddmmyyyy(start.date) : ddmmyyyy(new Date()),
        currentDate: ddmmyyyy(new Date()),
        status: 1,
      });
    } catch (e) {
      console.warn("[weekly-checkin] report copy failed:", e.message);
    }

    const startW = state.start && state.start.weightKg;
    return res.json(
      ApiResponse("1", "Measurements saved", {
        weekDate,
        changeSinceStart:
          startW != null && row.weightKg != null ? Math.round((row.weightKg - startW) * 10) / 10 : null,
      })
    );
  } catch (e) {
    console.error("[weekly-checkin] logMeasurements:", e);
    return res.json(ApiResponse("0", "Couldn't save. Please try again.", {}));
  }
};

exports.getHistory = async (req, res) => {
  try {
    return res.json(ApiResponse("1", "Measurements history", { rows: await historyFor(req.user.id) }));
  } catch (e) {
    console.error("[weekly-checkin] history:", e);
    return res.json(ApiResponse("0", "Couldn't load your history", {}));
  }
};
