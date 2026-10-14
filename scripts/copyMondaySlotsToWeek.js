// Copy Monday's class times to Tuesday–Saturday, with a mixed routine.
//
//   node scripts/copyMondaySlotsToWeek.js            (preview only, changes nothing)
//   node scripts/copyMondaySlotsToWeek.js --apply    (writes, in one transaction)
//
// What it does:
//   1. Makes sure Tuesday..Saturday each have a row in Times.
//   2. DELETES any classes already on Tuesday..Saturday.
//   3. For every Monday class, creates the same class on each of those days
//      with the SAME start, end and trainer, and a mixed routine: class type,
//      intensity and description rotate so each day (and each time slot)
//      gets a different workout. Link, meeting token and "trainer joined"
//      are NOT copied.
//   Monday's classes are never changed. Trial users' saved picks are NOT
//   touched (if a deleted Tue–Sat class was in someone's picks, that pick
//   simply stops matching; the preview tells you how many).
//
// Type / intensity spellings match the app's fixed options
// (fit_her-main lib/widgets/class_option_picker.dart), so colours match.

const db = require("../models");
const { Slot, Time, PreConsultationProfile, FreeTrailUsersSlots, sequelize } = db;
const { Op } = require("sequelize");

const APPLY = process.argv.includes("--apply");
const TARGET_DAYS = ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Rotation of routines. Each entry = one class type with its usual intensity
// and a short description clients see on the schedule.
const ROUTINES = [
  { type: "Yoga", level: "Low", description: "Gentle flow to stretch, breathe and ease stress. Good for hormones and sleep." },
  { type: "HIIT", level: "High", description: "Short bursts of cardio with quick rests to burn fat and lift your energy." },
  { type: "Pilates", level: "Medium", description: "Core and posture work on the mat to tone your belly, back and hips." },
  { type: "Strength", level: "Medium", description: "Bodyweight and light-weight moves to build strength and boost metabolism." },
  { type: "Zumba", level: "Medium", description: "Fun dance cardio to music. Move, sweat and smile." },
  { type: "Low Impact", level: "Low", description: "Easy-on-the-joints cardio and toning. Great for beginners and PCOS." },
];

function asJson(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (_) { return fallback; }
}

// Different routine per day AND per time slot: day d, slot i -> (i + d + 1).
function routineFor(dayIndex, slotIndex) {
  return ROUTINES[(slotIndex + dayIndex + 1) % ROUTINES.length];
}

async function main() {
  const t = await sequelize.transaction();
  try {
    const monday = await Time.findOne({ where: { day: "Monday" }, transaction: t });
    if (!monday) throw new Error("No Monday row in Times.");
    const mondaySlots = (await Slot.findAll({
      where: { TimeId: monday.id },
      order: [["id", "ASC"]],
      transaction: t,
    })).filter((s) => s.start && s.end && s.start !== "Start Time" && s.end !== "End Time");
    console.log(`Monday classes (not changed): ${mondaySlots.length}`);
    for (const s of mondaySlots) {
      console.log(`  #${s.id}  ${s.start} - ${s.end}  trainer ${s.trainerId}  (${s.type || "no type"})`);
    }
    if (!mondaySlots.length) throw new Error("Monday has no classes to copy.");

    // Trial picks pointing at classes we'd delete (informational only).
    const profiles = await PreConsultationProfile.findAll({ transaction: t });
    const pickedIds = new Set();
    for (const p of profiles) {
      const ws = asJson(p.workoutSection, null);
      if (ws && Array.isArray(ws.preferredSlotIds)) ws.preferredSlotIds.forEach((id) => pickedIds.add(Number(id)));
    }

    for (let d = 0; d < TARGET_DAYS.length; d++) {
      const day = TARGET_DAYS[d];
      let time = await Time.findOne({ where: { day }, transaction: t });
      if (!time) {
        console.log(`\n${day}: no Times row, ${APPLY ? "creating" : "would create"} it`);
        if (APPLY) time = await Time.create({ day, status: 1 }, { transaction: t });
      }

      if (time) {
        const old = await Slot.findAll({ where: { TimeId: time.id }, transaction: t });
        if (old.length) {
          const oldIds = old.map((s) => s.id);
          const trialRows = await FreeTrailUsersSlots.count({ where: { slotId: { [Op.in]: oldIds } }, transaction: t });
          const trialPicks = oldIds.filter((id) => pickedIds.has(id)).length;
          console.log(`\n${day}: ${APPLY ? "deleting" : "would delete"} ${old.length} existing class(es)` +
            (trialRows || trialPicks ? `  (in trial users' picks: ${trialPicks} class(es), ${trialRows} trial slot row(s), not changed)` : ""));
          if (APPLY) {
            await Slot.destroy({ where: { id: { [Op.in]: oldIds } }, transaction: t });
          }
        } else {
          console.log(`\n${day}: no existing classes`);
        }
      }

      for (let i = 0; i < mondaySlots.length; i++) {
        const s = mondaySlots[i];
        const r = routineFor(d, i);
        console.log(`  ${APPLY ? "+" : "would add"} ${s.start} - ${s.end}  ${r.type} / ${r.level}`);
        if (!APPLY) continue;
        await Slot.create(
          {
            start: s.start,
            end: s.end,
            trainerId: s.trainerId,
            TimeId: time.id,
            status: "Upcoming Class",
            type: r.type,
            level: r.level,
            description: r.description,
          },
          { transaction: t }
        );
      }
    }

    if (APPLY) {
      await t.commit();
      console.log("\nDONE. Tuesday–Saturday now follow Monday's times with a mixed routine.");
    } else {
      await t.rollback();
      console.log("\nPreview only, nothing changed. Run again with --apply to write.");
    }
  } catch (e) {
    await t.rollback();
    console.error("FAILED, nothing was changed:", e.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

main();
