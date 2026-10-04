const { Op } = require("sequelize");
const moment = require("moment-timezone");
const ApiResponse = require("../../helper/ApiResponse");
const {
  User,
  UserCycleData,
  WeeklyCheckin,
  DailyCheckin,
  ClassAttendance,
  ClassPresence,
  Slot,
  Time,
  PreConsultationProfile,
} = require("../../models");
const CyclePhase = require("../../helper/CyclePhaseCalculator");
const { getInsight } = require("../../helper/StaticInsights");
const { computeHydrationSummary } = require("./WaterController");
const popupEligibility = require("../../helper/popupEligibility");
const {
  computeTargetCalories,
  heightFeetToCm,
} = require("../../services/ai/utils/calorieTarget");

const DEFAULT_TIMEZONE = "Asia/Karachi";

// ───────── constants ─────────────────────────────────────────────────────

const PHASE_LABELS = {
  follicular: "Follicular Phase",
  ovulatory: "Ovulation",
  luteal: "Luteal Phase",
  menstrual: "Menstrual Phase",
};

// JS Date#getUTCDay() returns 0=Sunday..6=Saturday. Time.day stores the
// admin-chosen weekday name; we match by UTC weekday of the target
// calendar date.
const UTC_WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const SLEEP_TARGET_HOURS = 8;

// ───────── helpers ───────────────────────────────────────────────────────

function pad2(n) {
  return String(n).padStart(2, "0");
}

function localDateOnly(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(date, n) {
  const out = new Date(date);
  out.setDate(out.getDate() + n);
  return out;
}

function startOfIsoWeek(d = new Date()) {
  // Monday = start of week. Mutates a fresh copy.
  const copy = new Date(d);
  const day = copy.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

async function settledOrNull(promise, label) {
  try {
    return await promise;
  } catch (err) {
    console.error(`DashboardController: ${label} failed:`, err);
    return null;
  }
}

// ───────── sub-builders (each returns the subobject OR null) ─────────────

async function buildUserBlock(userRow) {
  if (!userRow) return null;
  const firstName = userRow.firstName || "";
  const initial = firstName ? firstName.charAt(0).toUpperCase() : "";
  // Signup goal category (Lose weight / Build strength & tone / etc.),
  // set by GoalScreen and re-settable from the PaidHero "Set goal →"
  // chip via POST /users/profile/main_goal. Distinct from goal.deltaKg
  // below, which is weight-tracking progress, not this category.
  return { firstName, initial, mainGoal: userRow.mainGoal || null };
}

async function buildCycleAndPhase(userId) {
  const row = await UserCycleData.findOne({ where: { userId } });
  if (!row || !row.lastPeriodDate || row.dataProvided !== 1) {
    return { cycle: null, phase: null };
  }
  const info = CyclePhase.calculate({
    lastPeriodDate: row.lastPeriodDate,
    averageCycleLength: row.averageCycleLength || 28,
  });
  if (!info) return { cycle: null, phase: null };

  const length = row.averageCycleLength || 28;
  const periodInDays = Math.max(0, length - info.cycleDay);

  const cycle = {
    dataProvided: true,
    cycleDay: info.cycleDay,
    phase: info.phase,
    phaseLabel: PHASE_LABELS[info.phase] || "Follicular Phase",
    periodInDays,
    averageCycleLength: length,
  };
  return { cycle, phase: info.phase };
}

async function buildGoal(userRow, userId) {
  // Streak: same query semantics as attendanceController.getMotivationStats.
  let streakDays = 0;
  try {
    const rows = await ClassAttendance.findAll({
      where: {
        user_id: userId,
        attended_at: {
          [Op.gte]: addDays(new Date(), -29),
        },
      },
      attributes: ["attended_at"],
      group: ["attended_at"],
      order: [["attended_at", "DESC"]],
    });
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    let cursor = todayMid.getTime();
    for (const r of rows) {
      const d = new Date(r.attended_at);
      d.setHours(0, 0, 0, 0);
      if (d.getTime() === cursor) {
        streakDays += 1;
        cursor -= 24 * 60 * 60 * 1000;
      } else if (d.getTime() < cursor) {
        break;
      }
    }
  } catch (err) {
    console.error("DashboardController.buildGoal streak:", err);
  }

  // Oldest + latest WeeklyCheckin queries run concurrently — they're
  // independent reads on the same table. Saves one round-trip vs. serial.
  let startingWeightKg = null;
  let currentWeightKg = null;
  let latestWeekDate = null;
  try {
    const [oldest, latest] = await Promise.all([
      WeeklyCheckin.findOne({
        where: { userId },
        order: [["weekDate", "ASC"]],
        attributes: ["weightKg", "weekDate"],
      }),
      WeeklyCheckin.findOne({
        where: { userId },
        order: [["weekDate", "DESC"]],
        attributes: ["weightKg", "weekDate"],
      }),
    ]);
    startingWeightKg = oldest ? oldest.weightKg : null;
    currentWeightKg = latest ? latest.weightKg : null;
    latestWeekDate = latest ? latest.weekDate : null;
  } catch (err) {
    console.error("DashboardController.buildGoal weight:", err);
  }

  const targetWeightKg = userRow ? userRow.targetWeightKg ?? null : null;
  // 'lose' | 'gain' | null — see save_target_weight's doc comment.
  // mainGoal === 'Lose weight' already implies 'lose' on its own; the
  // frontend resolves that fallback itself (it already has mainGoal in
  // the dashboard's user block) rather than this function reaching
  // outside its own userRow fields to duplicate that logic.
  const weightGoalDirection = userRow ? userRow.weightGoalDirection ?? null : null;
  const deltaKg =
    currentWeightKg != null && targetWeightKg != null
      ? Number((currentWeightKg - targetWeightKg).toFixed(1))
      : null;
  // Signed progress from starting anchor: positive = lost weight,
  // negative = gained. UI re-interprets the sign vs. target direction.
  const lostKg =
    startingWeightKg != null && currentWeightKg != null
      ? Number((startingWeightKg - currentWeightKg).toFixed(1))
      : null;

  // Days since last weigh-in. `weekDate` is a "YYYY-MM-DD" string anchored
  // to the week's Monday. Parse as a Date and diff against midnight today.
  let daysSinceLastWeighIn = null;
  if (latestWeekDate) {
    const latestMid = new Date(latestWeekDate);
    latestMid.setHours(0, 0, 0, 0);
    const todayMid = new Date();
    todayMid.setHours(0, 0, 0, 0);
    daysSinceLastWeighIn = Math.max(
      0,
      Math.floor((todayMid.getTime() - latestMid.getTime()) / 86400000)
    );
  }
  const isWeighInDue = (daysSinceLastWeighIn ?? 999) >= 7;

  return {
    targetWeightKg,
    weightGoalDirection,
    currentWeightKg,
    startingWeightKg,
    deltaKg,
    lostKg,
    streakDays,
    daysSinceLastWeighIn,
    isWeighInDue,
  };
}

// Slot.start / Slot.end are stored as canonical 24-hour UTC HH:mm strings
// (e.g. "03:00", "15:50"). For backwards compatibility this also accepts
// legacy 12-hour wall-clock strings ("03:00 PM"); those are interpreted as
// already-local — only used as a fallback if a row hasn't been migrated.
// Returns { hours, minutes, isUtc } or null.
function parseSlotTimeParts(s) {
  if (!s || typeof s !== "string") return null;
  const trimmed = s.trim();
  // Canonical 24-hour UTC.
  let m = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes, isUtc: true };
  }
  // Legacy 12-hour with AM/PM (treated as already-local).
  m = trimmed.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (m) {
    let hours = parseInt(m[1], 10);
    const minutes = parseInt(m[2], 10);
    const isPm = m[3].toUpperCase() === "PM";
    if (hours === 12) hours = isPm ? 12 : 0;
    else if (isPm) hours += 12;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes, isUtc: false };
  }
  return null;
}

// Build a moment for a slot's HH:mm anchored to a specific UTC date. The
// returned moment is in UTC; convert with .tz(userTz) for display.
function slotMomentOnUtcDate(parts, utcMomentDay) {
  const m = utcMomentDay.clone().utc().startOf("day");
  if (parts.isUtc) {
    return m.hour(parts.hours).minute(parts.minutes);
  }
  // Legacy local: treat the parts as already in the default timezone, then
  // convert to UTC. Used only for unmigrated rows.
  return moment
    .tz(
      `${m.format("YYYY-MM-DD")} ${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`,
      "YYYY-MM-DD HH:mm",
      DEFAULT_TIMEZONE
    )
    .utc();
}

async function buildLiveAndComingUp(userTz) {
  const tz = userTz || DEFAULT_TIMEZONE;
  const slots = await Slot.findAll({
    where: {
      start: { [Op.ne]: "Start Time" },
      end: { [Op.ne]: "End Time" },
      trainerId: { [Op.ne]: null },
    },
    include: [
      { model: User, attributes: ["id", "firstName", "lastName"] },
      { model: Time, attributes: ["id", "day"] },
    ],
  });

  const nowUtc = moment.utc();
  const todayUtc = nowUtc.clone().startOf("day");

  const formatLocal = (parts, utcDay) =>
    slotMomentOnUtcDate(parts, utcDay).clone().tz(tz).format("hh:mm A");

  // ── live: prefer the trainer's manual "In Progress" flip, but fall back
  // to real time-window detection so a class doesn't vanish from the app
  // between its scheduled start and whenever the trainer actually flips
  // the status. Without the fallback, `comingUp` below only ever keeps
  // strictly-future occurrences, so a slot whose start time has already
  // passed but hasn't been flipped yet has nowhere to render at all --
  // that's the bug behind the missing "STARTING SOON" home banner.
  //
  // PRE_START_LEAD_MINUTES additionally treats a slot as "live" starting
  // this many minutes BEFORE its scheduled start too, not just during the
  // [start, end) window -- this is what lets the home screen show its
  // pre-class card (currently: "Confirmed" from here, then "Get ready"
  // once inside the last 10 min -- see paid_hero_live_section.dart's
  // _kGetReadyLeadMinutes) ahead of time instead of only once class time
  // arrives. This constant is intentionally NOT the same 20-minute value
  // as the shared frontend resolver's _kSoonWindow (lib/utils/
  // slot_ui_state.dart) -- that one still drives the Workout Schedule
  // screen and the Coming Up tiles, which haven't adopted this longer
  // lead time.
  //
  // Either way, the real status (whatever it is) is passed through
  // untouched below, so the frontend decides what to actually render
  // (Confirmed / Cancelled / Get ready / LIVE / blocked) -- this block
  // only decides *which* slot to surface as `live`.
  const PRE_START_LEAD_MINUTES = 30;
  const isWithinTodaysWindow = (slot) => {
    if (!slot.Time || !slot.Time.day) return false;
    const utcDayIdx = UTC_WEEKDAY_NAMES.indexOf(slot.Time.day);
    if (utcDayIdx < 0 || todayUtc.day() !== utcDayIdx) return false;
    const startParts = parseSlotTimeParts(slot.start);
    const endParts = parseSlotTimeParts(slot.end);
    if (!startParts || !endParts) return false;
    const startUtc = slotMomentOnUtcDate(startParts, todayUtc);
    const endUtc = slotMomentOnUtcDate(endParts, todayUtc);
    if (endUtc.isSameOrBefore(startUtc)) endUtc.add(1, "day");
    const windowStart = startUtc
      .clone()
      .subtract(PRE_START_LEAD_MINUTES, "minutes");
    return nowUtc.isSameOrAfter(windowStart) && nowUtc.isBefore(endUtc);
  };

  let live = null;
  let liveSlot = slots.find((s) => s.status === "In Progress");
  if (!liveSlot) {
    liveSlot = slots.find((s) => isWithinTodaysWindow(s));
  }
  if (liveSlot) {
    const trainer = liveSlot.User;
    const trainerName = trainer
      ? `${trainer.firstName || ""} ${trainer.lastName || ""}`.trim()
      : "";
    const startParts = parseSlotTimeParts(liveSlot.start);
    const endParts = parseSlotTimeParts(liveSlot.end);
    const localStart = startParts ? formatLocal(startParts, todayUtc) : liveSlot.start;
    const localEnd = endParts ? formatLocal(endParts, todayUtc) : liveSlot.end;

    // Real duration straight from the slot's own start/end -- no separate
    // data source needed. Same overnight-slot handling as
    // isWithinTodaysWindow (end rolls to the next day if it isn't
    // strictly after start).
    let durationMinutes = null;
    if (startParts && endParts) {
      const startUtc = slotMomentOnUtcDate(startParts, todayUtc);
      const endUtc = slotMomentOnUtcDate(endParts, todayUtc);
      if (endUtc.isSameOrBefore(startUtc)) endUtc.add(1, "day");
      durationMinutes = Math.round(endUtc.diff(startUtc, "minutes", true));
    }

    // Real live headcount from ClassPresence -- written by the app's own
    // join/leave calls (see classPresenceController.js). Counts users
    // currently connected (leftAt still null), not just everyone who ever
    // joined, so it tracks who's actually in the room right now.
    let participantCount = null;
    try {
      participantCount = await ClassPresence.count({
        where: { slotId: liveSlot.id, leftAt: { [Op.is]: null } },
      });
    } catch (err) {
      console.error(
        "DashboardController.buildLiveAndComingUp presence count:",
        err
      );
    }

    live = {
      slotId: liveSlot.id,
      classType: liveSlot.type,
      trainerName: trainerName.length ? trainerName : null,
      durationMinutes,
      caloriesEstimate: null,
      participantCount,
      elapsedMinutes: null,
      startedAtUtc: null,
      status: liveSlot.status,
      trainerLink: liveSlot.trainerLink || null,
      start: localStart,
      end: localEnd,
    };
  }

  // ── comingUp: find each slot's next future occurrence (anchored in UTC),
  // then convert to user's timezone for display. weekday and dayOffset
  // reflect what the user-local day actually is, so a 23:00 UTC Monday slot
  // shows as Tuesday for a PKT user.
  const liveSlotId = liveSlot ? liveSlot.id : null;
  const todayLocal = nowUtc.clone().tz(tz).startOf("day");
  const upcoming = [];

  for (const slot of slots) {
    if (slot.id === liveSlotId) continue;
    if (slot.status === "In Progress") continue;
    if (!slot.Time || !slot.Time.day) continue;
    const utcDayIdx = UTC_WEEKDAY_NAMES.indexOf(slot.Time.day);
    if (utcDayIdx < 0) continue;
    const startParts = parseSlotTimeParts(slot.start);
    if (!startParts) continue;

    // Find the next UTC occurrence of (slot's weekday, slot's HH:mm) that
    // is strictly in the future.
    let futureUtc = null;
    for (let dayShift = 0; dayShift < 7; dayShift++) {
      const candidateDay = todayUtc.clone().add(dayShift, "days");
      if (candidateDay.day() !== utcDayIdx) continue;
      const candidateAtTime = slotMomentOnUtcDate(startParts, candidateDay);
      if (candidateAtTime.isSameOrBefore(nowUtc)) continue;
      futureUtc = candidateAtTime;
      break;
    }
    if (!futureUtc) continue;

    const futureLocal = futureUtc.clone().tz(tz);
    const trainer = slot.User;
    const trainerName = trainer
      ? `${trainer.firstName || ""} ${trainer.lastName || ""}`.trim()
      : "";

    const localStart = futureLocal.format("hh:mm A");
    const endParts = parseSlotTimeParts(slot.end);
    let localEnd = null;
    if (endParts) {
      let endUtc = slotMomentOnUtcDate(endParts, futureUtc);
      if (endUtc.isBefore(futureUtc)) endUtc.add(1, "day");
      localEnd = endUtc.clone().tz(tz).format("hh:mm A");
    }

    const dayOffset = futureLocal.clone().startOf("day").diff(todayLocal, "days");

    upcoming.push({
      _sortKey: futureUtc.valueOf(),
      id: slot.id,
      classType: slot.type,
      weekday: futureLocal.format("dddd"),
      start: localStart,
      end: localEnd,
      // Legacy field kept on the wire for shipped clients; now also in
      // the user's local timezone formatted as "hh:mm A".
      startTimeUtc: localStart,
      durationMinutes: null,
      dayOffset,
      trainerName: trainerName.length ? trainerName : null,
      // Added so the frontend can run the same resolveSlotUIState() the
      // Workout Schedule screen uses -- lets the home screen render the
      // amber "Starts in Xm" countdown identically instead of plain text.
      status: slot.status,
      trainerLink: slot.trainerLink || null,
    });
  }
  upcoming.sort((a, b) => a._sortKey - b._sortKey);
  const collected = upcoming.slice(0, 3).map(({ _sortKey, ...rest }) => rest);

  return { live, comingUp: collected };
}

async function buildTodayCheckin(userId) {
  const dateStr = localDateOnly();
  const row = await DailyCheckin.findOne({ where: { userId, date: dateStr } });
  if (!row) return null;
  return {
    date: row.date,
    moodLevel: row.moodLevel ?? null,
    sleepHours: row.sleepHours ?? null,
    symptoms: [],
  };
}

async function buildSleep(userId) {
  // hoursToday
  const dateStr = localDateOnly();
  let hoursToday = null;
  try {
    const row = await DailyCheckin.findOne({
      where: { userId, date: dateStr },
      attributes: ["sleepHours"],
    });
    hoursToday = row && row.sleepHours != null ? row.sleepHours : null;
  } catch (err) {
    console.error("DashboardController.buildSleep today:", err);
  }

  // Week delta: avg(last 7 days) - avg(prior 7 days). null if either window has <3 points.
  let weekDeltaHours = null;
  try {
    const now = new Date();
    const fourteenAgo = addDays(now, -14);
    const rows = await DailyCheckin.findAll({
      where: {
        userId,
        sleepHours: { [Op.not]: null },
        date: {
          [Op.gte]: localDateOnly(fourteenAgo),
        },
      },
      attributes: ["date", "sleepHours"],
    });
    const recent = [];
    const prior = [];
    const sevenAgoStr = localDateOnly(addDays(now, -7));
    for (const r of rows) {
      if (r.date >= sevenAgoStr) recent.push(r.sleepHours);
      else prior.push(r.sleepHours);
    }
    if (recent.length >= 3 && prior.length >= 3) {
      const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
      weekDeltaHours = Number((avg(recent) - avg(prior)).toFixed(2));
    }
  } catch (err) {
    console.error("DashboardController.buildSleep delta:", err);
  }

  return {
    hoursToday,
    targetHours: SLEEP_TARGET_HOURS,
    weekDeltaHours,
  };
}

async function buildStats(userId) {
  // Workouts this week: distinct attended_at dates since Monday.
  let workoutsThisWeek = 0;
  try {
    const weekStart = startOfIsoWeek();
    const rows = await ClassAttendance.findAll({
      where: {
        user_id: userId,
        attended_at: { [Op.gte]: weekStart },
      },
      attributes: ["attended_at"],
      group: ["attended_at"],
    });
    workoutsThisWeek = rows.length;
  } catch (err) {
    console.error("DashboardController.buildStats workouts:", err);
  }

  // Weight delta this week: latest 2 WeeklyCheckins within last 14 days.
  let weightDeltaKgThisWeek = null;
  try {
    const fourteenAgo = localDateOnly(addDays(new Date(), -14));
    const rows = await WeeklyCheckin.findAll({
      where: {
        userId,
        weightKg: { [Op.not]: null },
        weekDate: { [Op.gte]: fourteenAgo },
      },
      order: [["weekDate", "DESC"]],
      limit: 2,
      attributes: ["weightKg"],
    });
    if (rows.length === 2) {
      weightDeltaKgThisWeek = Number(
        (rows[0].weightKg - rows[1].weightKg).toFixed(1)
      );
    }
  } catch (err) {
    console.error("DashboardController.buildStats weight:", err);
  }

  // Daily calorie target: same Mifflin-St Jeor calculator that already
  // drives AI diet-plan generation (services/ai/utils/calorieTarget.js),
  // so the number shown on the home screen always matches the logic a
  // generated plan is built around, instead of a second, possibly
  // inconsistent formula. There's no calorie *consumption* tracking
  // anywhere yet (meal logging only records followed/alternative/
  // skipped, not food or kcal) — caloriesRemaining stays null; this is
  // a daily target, not a live "remaining today" count.
  let dailyKcalBudget = null;
  try {
    const userRow = await User.findOne({
      where: { id: userId },
      attributes: ["age", "weight", "height", "mainGoal"],
    });
    if (userRow && userRow.weight && userRow.height && userRow.age) {
      const profile = await PreConsultationProfile.findOne({
        where: { userId },
        attributes: ["goals", "lifestyle"],
      });
      dailyKcalBudget = computeTargetCalories({
        weightKg: userRow.weight,
        heightCm: heightFeetToCm(userRow.height),
        age: userRow.age,
        lifestyle: profile ? profile.lifestyle : null,
        goalKey: (profile && profile.goals) || userRow.mainGoal,
      });
    }
  } catch (err) {
    console.error("DashboardController.buildStats calories:", err);
  }

  return {
    workoutsThisWeek,
    weightDeltaKgThisWeek,
    caloriesRemaining: null,
    dailyKcalBudget,
  };
}

async function buildSocial() {
  try {
    const today = localDateOnly();
    const rows = await ClassAttendance.findAll({
      where: { attended_at: today },
      attributes: ["user_id"],
      group: ["user_id"],
    });
    return { womenJoinedToday: rows.length };
  } catch (err) {
    console.error("DashboardController.buildSocial:", err);
    return { womenJoinedToday: 0 };
  }
}

// ───────── main handler ───────────────────────────────────────────────────

async function getDashboard(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

  // Everything below is tolerant: a failure in any subobject yields null
  // for that key, not a 500 for the whole request.
  let userRow = null;
  try {
    userRow = await User.findOne({
      where: { id: userId },
      attributes: [
        "id",
        "firstName",
        "targetWeightKg",
        "timeZone",
        "mainGoal",
        "weightGoalDirection",
      ],
    });
  } catch (err) {
    console.error("DashboardController.getDashboard user lookup:", err);
  }

  const userTz = userRow && userRow.timeZone ? userRow.timeZone : DEFAULT_TIMEZONE;

  const [
    userBlock,
    cycleAndPhase,
    goal,
    liveAndComingUp,
    todayCheckin,
    hydration,
    sleep,
    stats,
    social,
  ] = await Promise.all([
    settledOrNull(buildUserBlock(userRow), "user"),
    settledOrNull(buildCycleAndPhase(userId), "cycle"),
    settledOrNull(buildGoal(userRow, userId), "goal"),
    settledOrNull(buildLiveAndComingUp(userTz), "liveAndComingUp"),
    settledOrNull(buildTodayCheckin(userId), "todayCheckin"),
    settledOrNull(computeHydrationSummary(userId), "hydration"),
    settledOrNull(buildSleep(userId), "sleep"),
    settledOrNull(buildStats(userId), "stats"),
    settledOrNull(buildSocial(), "social"),
  ]);

  const cycle = cycleAndPhase ? cycleAndPhase.cycle : null;
  const phase = cycleAndPhase ? cycleAndPhase.phase : null;
  const live = liveAndComingUp ? liveAndComingUp.live : null;
  const comingUp = liveAndComingUp ? liveAndComingUp.comingUp : [];

  const insight = getInsight(phase, cycle ? cycle.cycleDay : null);

  const cycleCard = cycle
    ? {
        cycleDay: cycle.cycleDay,
        phase: cycle.phase,
        periodInDays: cycle.periodInDays,
      }
    : null;

  // Fresh popup eligibility evaluation. We run on every dashboard fetch
  // so a freshly-purchased user (or one whose cycle just rolled over)
  // sees the right popup immediately without waiting for the hourly
  // cron. evaluateForUser is bounded — small per-user query budget — so
  // dashboard latency is acceptable.
  let pendingPopups = [];
  try {
    await popupEligibility.evaluateForUser(userId);
    pendingPopups = await popupEligibility.listForUser(userId, 5);
  } catch (err) {
    console.error("DashboardController.getDashboard popups:", err);
    pendingPopups = [];
  }

  const data = {
    user: userBlock,
    cycle,
    goal,
    live,
    comingUp,
    insight: insight
      ? {
          source: "static",
          text: insight.text,
          accentHex: insight.accentHex,
        }
      : null,
    todayCheckin,
    hydration,
    sleep,
    stats,
    cycleCard,
    nutrition: null,
    social,
    unreadNotifications: null,
    pendingPopups,
  };

  return res.json(ApiResponse("1", "Dashboard", data));
}

module.exports = { getDashboard };
