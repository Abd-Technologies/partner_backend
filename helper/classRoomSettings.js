// The main class room (one Zoom meeting for every trainer).
//
// Which room a class uses (one truth, see models/Slot.js effectiveLink):
//   1. today's "Other link" the trainer set for that class
//   2. the trainer's OWN room, if admin gave her one (Users.zoomRoom)
//   3. the MAIN room (this file)
// Slot.trainerLink stores 2-or-3 so every reader stays simple; it is
// rewritten whenever the main room or a trainer's room changes.
const KEY = "mainZoomRoom";
let cached = null;
let loaded = false;

function models() {
  return require("../models");
}

async function load() {
  try {
    const { AppSetting } = models();
    if (!AppSetting) return null;
    const row = await AppSetting.findOne({ where: { key: KEY } });
    cached = row && row.value ? String(row.value) : null;
    loaded = true;
  } catch (_) {
    /* table not created yet: keep the last value */
  }
  return cached;
}

/** Sync read for Slot.effectiveLink (refreshed every minute). */
function mainRoom() {
  if (!loaded) load();
  return cached;
}

async function setMainRoom(room, adminId) {
  const { AppSetting } = models();
  const [row] = await AppSetting.findOrCreate({ where: { key: KEY }, defaults: { value: room, updatedBy: adminId } });
  row.value = room;
  row.updatedBy = adminId;
  await row.save();
  cached = room;
  loaded = true;
  return room;
}

/**
 * Rewrites the stored room on classes: trainers with their own room keep
 * it, everyone else (and classes with no trainer) gets the main room.
 */
async function syncSlotRooms(trainerId = null) {
  const { Op } = require("sequelize");
  const { User, Slot } = models();
  const TRAINER = process.env.TRAINER || "Trainer";
  const main = cached;
  const where = { userType: TRAINER };
  if (trainerId) where.id = trainerId;
  const trainers = await User.findAll({ where, attributes: ["id", "zoomRoom"] });
  let updated = 0;
  for (const t of trainers) {
    const [n] = await Slot.update({ trainerLink: t.zoomRoom || main }, { where: { trainerId: t.id } });
    updated += n;
  }
  if (!trainerId) {
    const [n] = await Slot.update({ trainerLink: main }, { where: { trainerId: { [Op.is]: null } } });
    updated += n;
  }
  return updated;
}

const timer = setInterval(load, 60 * 1000);
if (timer.unref) timer.unref();

module.exports = { load, mainRoom, setMainRoom, syncSlotRooms };
