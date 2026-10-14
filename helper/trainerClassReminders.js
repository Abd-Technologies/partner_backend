// Trainer-side safety nets for live classes (Oct 2026).
//
//  • sendTrainerStartReminders — every minute:
//      10 min before: "Your 8:00 PM Zumba starts in 10 minutes. Tap Start…"
//      3 min after (not started): "Your class is waiting… auto-cancels at 8:10"
//    Stops a class being auto-cancelled only because she forgot Start.
//  • morningRoomCheck — 07:00 PKT: classes today whose trainer has no Zoom
//    room (and no Other link) → alert admins + that trainer.
//
// Staff pushes are never muted by quiet hours (helper/notification.js).
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const Redis = require("ioredis");
const { Slot, Time, User } = require("../models");
const sendNotification = require("./notification");
const { parseEndAsUtc } = require("./timeFormats");

const PKT = "Asia/Karachi";
const NOT_STARTED = [null, "", "Upcoming Class", "Class Link Added", "Class is starting soon", "Confirmed"];
const redis = new Redis();

async function once(key) {
  try {
    return (await redis.set(key, "1", "EX", 60 * 60 * 30, "NX")) === "OK";
  } catch (_) {
    return true;
  }
}

async function todaysClasses() {
  const todayPkt = moment.tz(PKT).startOf("day");
  const slots = await Slot.findAll({
    where: { trainerId: { [Op.ne]: null } },
    include: [
      { model: Time, attributes: ["day"], where: { day: todayPkt.format("dddd") } },
      { model: User, attributes: ["id", "firstName", "lastName", "deviceToken", "timeZone", "zoomRoom"] },
    ],
  });
  return { todayPkt, slots };
}

const label = (slot, startUtc, tz) =>
  `${startUtc.clone().tz(tz || PKT).format("h:mm A")} ${(slot.type || "class").trim()}`;

async function sendTrainerStartReminders() {
  const { todayPkt, slots } = await todaysClasses();
  const nowUtc = moment.utc();
  const LATE = require("./autoCancelLateClasses").LATE_START_MINUTES;
  let sent = 0;
  for (const slot of slots) {
    const trainer = slot.User;
    if (!trainer || !trainer.deviceToken) continue;
    if (!NOT_STARTED.includes(slot.status ?? null)) continue;
    const startUtc = parseEndAsUtc(slot.start, todayPkt);
    if (!startUtc) continue;
    const mins = startUtc.diff(nowUtc, "minutes", true);
    const day = todayPkt.format("YYYYMMDD");
    const name = label(slot, startUtc, trainer.timeZone);
    const noRoom = !slot.effectiveLink();
    let msg = null;
    if (mins <= 10 && mins > 8 && (await once(`trainerremind:${slot.id}:${day}:before`))) {
      msg = {
        title: "Your class starts in 10 minutes",
        body: noRoom
          ? `${name}: no Zoom room is set for you. Use "Other link" in the class screen, then tap Start.`
          : `${name}. Open the class and tap Start when you're ready 💪`,
      };
    } else if (mins <= -3 && mins > -5 && (await once(`trainerremind:${slot.id}:${day}:late`))) {
      const cutoff = startUtc.clone().add(LATE, "minutes").tz(trainer.timeZone || PKT).format("h:mm A");
      msg = {
        title: "Your class is waiting ⏳",
        body: `${name} hasn't started. Tap Start now, it's cancelled automatically at ${cutoff}.`,
      };
    }
    if (!msg) continue;
    await sendNotification([trainer.deviceToken], msg, { type: "trainerClassReminder", slotId: String(slot.id) });
    sent++;
  }
  return sent;
}

async function morningRoomCheck() {
  const { todayPkt, slots } = await todaysClasses();
  const missing = slots.filter((s) => s.status !== "Cancelled" && !s.effectiveLink());
  if (!missing.length) return 0;

  const lines = missing.map((s) => {
    const at = parseEndAsUtc(s.start, todayPkt);
    const who = s.User ? `${s.User.firstName || ""} ${s.User.lastName || ""}`.trim() : "no trainer";
    return `${at ? at.clone().tz(PKT).format("h:mm A") : s.start} ${(s.type || "class").trim()} (${who})`;
  });

  const admins = await User.findAll({
    where: { userType: process.env.ADMIN || "Admin", deviceToken: { [Op.ne]: null } },
    attributes: ["deviceToken"],
  });
  const adminTokens = admins.map((a) => a.deviceToken).filter(Boolean);
  if (adminTokens.length) {
    await sendNotification(
      adminTokens,
      {
        title: `⚠️ ${missing.length} class${missing.length > 1 ? "es" : ""} today ha${missing.length > 1 ? "ve" : "s"} no Zoom room`,
        body: `${lines.slice(0, 4).join(", ")}${lines.length > 4 ? "…" : ""}. Add the trainer's room in Trainer Zoom Rooms.`,
      },
      { type: "classRoomMissing" }
    );
  }
  const trainerTokens = new Set(missing.map((s) => s.User && s.User.deviceToken).filter(Boolean));
  if (trainerTokens.size) {
    await sendNotification(
      [...trainerTokens],
      {
        title: "No Zoom room set for your classes",
        body: 'Ask admin to add your Zoom room. For today, use "Other link" in the class screen before you tap Start.',
      },
      { type: "classRoomMissing" }
    );
  }
  console.log(`[room-check] ${missing.length} class(es) today without a room: ${lines.join(" | ")}`);
  return missing.length;
}

module.exports = { sendTrainerStartReminders, morningRoomCheck };
