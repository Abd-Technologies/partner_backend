// Class rooms: admin sets each trainer's Zoom room once; trainers only
// tap Start (or set an "Other link" for today on a bad day).
// See helper/classLinks.js and models/Slot.js.
const { Op } = require("sequelize");
const { User, Slot, Time } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const { todayPkt, normalizeZoomRoom, normalizeBackupLink, openableLink } = require("../../helper/classLinks");
const roomSettings = require("../../helper/classRoomSettings");
const { isAdmin, adminsOnlyMessage } = require("../../helper/roles");

const ADMIN = process.env.ADMIN || "Admin";
const TRAINER = process.env.TRAINER || "Trainer";

async function me(req) {
  if (!req.user || !req.user.id) return null;
  return User.findByPk(req.user.id, { attributes: ["id", "userType"] });
}

/** GET /admin/trainerRooms — every trainer with her Zoom room. Admin only. */
async function trainerRooms(req, res) {
  const actor = await me(req);
  if (!isAdmin(actor)) return res.json(ApiResponse("0", adminsOnlyMessage(actor), {}));
  const trainers = await User.findAll({
    where: { userType: TRAINER },
    attributes: ["id", "firstName", "lastName", "email", "zoomRoom"],
    order: [["firstName", "ASC"]],
  });
  const counts = await Slot.findAll({
    attributes: ["trainerId"],
    where: { trainerId: { [Op.in]: trainers.map((t) => t.id) } },
  });
  const countBy = counts.reduce((m, s) => m.set(s.trainerId, (m.get(s.trainerId) || 0) + 1), new Map());
  return res.json(
    ApiResponse("1", "Trainer rooms", {
      mainRoom: await roomSettings.load(),
      trainers: trainers.map((t) => ({
        id: t.id,
        name: `${t.firstName || ""} ${t.lastName || ""}`.trim(),
        email: t.email,
        zoomRoom: t.zoomRoom || null,
        classes: countBy.get(t.id) || 0,
      })),
    })
  );
}

/**
 * POST /admin/mainClassRoom { zoomRoom } — the ONE Fit Her Zoom room every
 * trainer uses (no two classes at the same time). Trainers with their own
 * room keep it. Accepts "812 3456 7890" or a Zoom invite link.
 */
async function setMainRoom(req, res) {
  const actor = await me(req);
  if (!isAdmin(actor)) return res.json(ApiResponse("0", adminsOnlyMessage(actor), {}));
  const room = normalizeZoomRoom((req.body || {}).zoomRoom);
  if (!room) {
    return res.json(ApiResponse("0", "Enter a valid Zoom meeting number (9–11 digits) or a Zoom invite link.", {}));
  }
  await roomSettings.setMainRoom(room, actor.id);
  const updated = await roomSettings.syncSlotRooms();
  console.log(`[class-rooms] main room set by admin ${actor.id}; ${updated} class(es) updated`);
  return res.json(ApiResponse("1", "Main class room saved", { mainRoom: room, classesUpdated: updated }));
}

/**
 * POST /admin/trainerRoom { trainerId, zoomRoom } — OPTIONAL own room for
 * one trainer (only needed if she teaches at the same time as someone
 * else). Empty zoomRoom = remove it, she goes back to the main room.
 */
async function setTrainerRoom(req, res) {
  const actor = await me(req);
  if (!isAdmin(actor)) return res.json(ApiResponse("0", adminsOnlyMessage(actor), {}));
  const { trainerId, zoomRoom } = req.body || {};
  const clearing = zoomRoom == null || String(zoomRoom).trim() === "";
  const room = clearing ? null : normalizeZoomRoom(zoomRoom);
  if (!clearing && !room) {
    return res.json(ApiResponse("0", "Enter a valid Zoom meeting number (9–11 digits) or a Zoom invite link.", {}));
  }
  const trainer = await User.findOne({ where: { id: trainerId, userType: TRAINER } });
  if (!trainer) return res.json(ApiResponse("0", "Trainer not found", {}));
  trainer.zoomRoom = room;
  await trainer.save();
  await roomSettings.load();
  const updated = await roomSettings.syncSlotRooms(trainer.id);
  console.log(`[class-rooms] trainer ${trainer.id} own room ${room ? "set" : "removed"} by admin ${actor.id}; ${updated} class(es) updated`);
  return res.json(
    ApiResponse("1", room ? "Own room saved" : "She now uses the main room", {
      trainerId: trainer.id,
      zoomRoom: room,
      mainRoom: roomSettings.mainRoom(),
      classesUpdated: updated,
    })
  );
}

async function loadTrainerSlot(req, slotId) {
  const actor = await me(req);
  if (!actor) return { error: "User not loggedIn!" };
  const slot = await Slot.findByPk(slotId, {
    include: [
      { model: User, attributes: ["id", "firstName", "lastName", "zoomRoom"] },
      { model: Time, attributes: ["day"] },
    ],
  });
  if (!slot) return { error: "Class not found" };
  if (!isAdmin(actor) && Number(slot.trainerId) !== Number(actor.id)) {
    return { error: "This is not your class" };
  }
  return { actor, slot };
}

function classInfo(slot) {
  const room = (slot.User && slot.User.zoomRoom) || roomSettings.mainRoom() || null;
  const usesBackup = slot.usesBackupLink();
  const link = slot.effectiveLink();
  return {
    slotId: slot.id,
    start: slot.start,
    end: slot.end,
    type: slot.type,
    level: slot.level,
    day: slot.Time ? slot.Time.day : null,
    status: slot.status || "Upcoming Class",
    zoomRoom: room,
    platform: usesBackup ? "other" : "zoom",
    backupLink: usesBackup ? slot.getDataValue("backupLink") : null,
    hasRoom: !!link,
    openLink: openableLink(link),
  };
}

/** GET /admin/trainerClass/:slotId — what the trainer's class screen shows. */
async function trainerClass(req, res) {
  const r = await loadTrainerSlot(req, req.params.slotId);
  if (r.error) return res.json(ApiResponse("0", r.error, {}));
  return res.json(ApiResponse("1", "Class", classInfo(r.slot)));
}

/**
 * POST /admin/trainerClass/backupLink { slotId, link } — "Other link" for
 * TODAY only. link = null/"" goes back to her Zoom room. No push: users get
 * whatever link is current the moment the class is live.
 */
async function setBackupLink(req, res) {
  const { slotId, link } = req.body || {};
  const r = await loadTrainerSlot(req, slotId);
  if (r.error) return res.json(ApiResponse("0", r.error, {}));
  const slot = r.slot;
  if (link == null || String(link).trim() === "") {
    slot.setDataValue("backupLink", null);
    slot.setDataValue("backupLinkDate", null);
  } else {
    const clean = normalizeBackupLink(link);
    if (!clean) return res.json(ApiResponse("0", "Paste a link that starts with https:// or a Zoom meeting number", {}));
    slot.setDataValue("backupLink", clean);
    slot.setDataValue("backupLinkDate", todayPkt());
  }
  slot.changed("backupLink", true);
  slot.changed("backupLinkDate", true);
  await slot.save();

  // Class already live: open apps switch to the new link right away.
  if (slot.status === "In Progress") {
    try {
      const { getIO } = require("../../socket");
      const plain = slot.get({ plain: true });
      const u = plain.User || {};
      const trainer = { id: u.id, firstName: u.firstName, lastName: u.lastName, email: "" };
      delete plain.Time;
      delete plain.User;
      getIO().emit("slotUpdate", { upcomingSlot: JSON.stringify(plain), trainer: JSON.stringify(trainer) });
    } catch (_) {}
  }
  return res.json(ApiResponse("1", link ? "Backup link set for today" : "Back to Zoom", classInfo(slot)));
}

module.exports = { trainerRooms, setTrainerRoom, setMainRoom, trainerClass, setBackupLink, classInfo };
