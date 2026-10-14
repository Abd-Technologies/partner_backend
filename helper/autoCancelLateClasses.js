// Auto-cancel a workout class that never started.
//
// If the trainer hasn't started a class (status still "Upcoming Class" /
// "Class Link Added") 10 minutes after its start time (PKT), the class is
// cancelled, everyone booked gets an apology push, and an in-app popup
// (POPUP_CLASS_CANCELLED) that points to the next class today.
//
// Runs every minute from app.js. The daily 00:01 reset puts every slot
// back to "Upcoming Class", so each class can be auto-cancelled at most
// once per day.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const { Slot, Time, UserPlan, Plan, User, TrialJourney } = require("../models");
const { CANONICAL_TZ, parseEndAsUtc } = require("./timeFormats");
const { activeUserPlanWhere } = require("./activePackage");
const sendNotification = require("./notification");
const popupEligibility = require("./popupEligibility");

const LATE_START_MINUTES = 10;
const POPUP = "POPUP_CLASS_CANCELLED";
// A "your class today was cancelled" popup makes no sense the next day.
const POPUP_MAX_AGE_HOURS = 12;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "Class is starting soon" / "Confirmed" were set by old trainer buttons.
const NOT_STARTED = ["Upcoming Class", "Class Link Added", "Class is starting soon", "Confirmed"];

function classLabel(slot) {
  const type = (slot.type || "").trim();
  return type ? `${slot.start} ${type}` : `${slot.start} class`;
}

// Everyone who should hear about this class: the shared class rule
// (picked times, or all classes if she never picked) — helper/classAudience.js.
async function rosterUserIds(slot) {
  const { getClassAudience } = require("./classAudience");
  const audience = await getClassAudience(slot);
  return audience.map((u) => u.id);
}

async function autoCancelLateClasses() {
  const nowUtc = moment.utc();
  const todayPkt = moment.tz(CANONICAL_TZ);
  const dayName = WEEKDAYS[todayPkt.day()];

  const todays = await Slot.findAll({
    where: { trainerId: { [Op.ne]: null } },
    include: [{ model: Time, attributes: ["day"], where: { day: dayName } }],
  });

  const toCancel = [];
  for (const slot of todays) {
    const status = slot.status || "Upcoming Class";
    if (!NOT_STARTED.includes(status)) continue;
    const startUtc = parseEndAsUtc(slot.start, todayPkt);
    const endUtc = parseEndAsUtc(slot.end, todayPkt);
    if (!startUtc) continue;
    const cutoff = startUtc.clone().add(LATE_START_MINUTES, "minutes");
    if (nowUtc.isBefore(cutoff)) continue;
    if (endUtc && nowUtc.isAfter(endUtc)) continue; // class time already over
    toCancel.push(slot);
  }
  if (toCancel.length === 0) return [];

  for (const slot of toCancel) {
    // Claim the row first so two overlapping runs can't double-notify.
    const [changed] = await Slot.update(
      { status: "Cancelled", completed_by: null, status_changed_at: new Date() },
      { where: { id: slot.id, [Op.or]: [{ status: { [Op.in]: NOT_STARTED } }, { status: null }] } }
    );
    if (!changed) continue;
    slot.status = "Cancelled";
    console.log(
      `[class-analytics] CLASS_AUTO_CANCELLED_NOT_STARTED: slotId=${slot.id} trainerId=${slot.trainerId} scheduledStart="${slot.start}"`
    );

    await announceCancelled(slot, { late: true, todays });
  }
  return toCancel.map((s) => s.id);
}


/**
 * Tell everyone a class is cancelled — the SAME warm message, next class
 * and in-app popup whether the server auto-cancelled it (late: true) or
 * the trainer tapped Cancel (late: false). Also flips open screens via
 * the socket.
 */
async function announceCancelled(slot, { late = false, todays = null } = {}) {
  const nowUtc = moment.utc();
  const todayPkt = moment.tz(CANONICAL_TZ);
  if (!todays) {
    const dayName = WEEKDAYS[todayPkt.day()];
    todays = await Slot.findAll({
      where: { trainerId: { [Op.ne]: null } },
      include: [{ model: Time, attributes: ["day"], where: { day: dayName } }],
    });
  }
    // Next class today that starts after this one and hasn't been cancelled.
    const startUtc = parseEndAsUtc(slot.start, todayPkt);
    const next = todays
      .filter((s) => s.id !== slot.id && s.status !== "Cancelled")
      .map((s) => ({ s, at: parseEndAsUtc(s.start, todayPkt) }))
      .filter((x) => x.at && x.at.isAfter(startUtc) && x.at.isAfter(nowUtc))
      .sort((a, b) => a.at.valueOf() - b.at.valueOf())[0];
    const nextLabel = next ? classLabel(next.s) : null;

    const body =
      (late
        ? `We're sorry, your ${classLabel(slot)} couldn't start on time, so we've cancelled it. `
        : `We're sorry, your ${classLabel(slot)} has been cancelled today. `) +
      `Your time is important to us.` +
      (nextLabel ? ` Join the next class at ${nextLabel}.` : " See you at the next class.");

    // Live socket update so open schedules flip to "Cancelled" right away.
    // The app parses `trainer` as a user object; sending null crashed its
    // slotUpdate handler, so open screens never refreshed.
    try {
      const { getIO } = require("../socket");
      const trainer = await User.findByPk(slot.trainerId, {
        attributes: ["id", "firstName", "lastName", "email"],
      });
      const plain = slot.get ? slot.get({ plain: true }) : slot;
      delete plain.Time;
      delete plain.User;
      getIO().emit("slotUpdate", {
        upcomingSlot: JSON.stringify(plain),
        trainer: JSON.stringify(trainer || { id: 0, firstName: "", lastName: "", email: "" }),
      });
    } catch (e) {
      console.error("[auto-cancel-class] socket emit failed:", e.message);
    }

    let userIds = [];
    try {
      userIds = await rosterUserIds(slot);
    } catch (e) {
      console.error("[auto-cancel-class] roster failed:", e.message);
    }
    if (userIds.length === 0) return;

    const users = await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ["id", "deviceToken"] });
    const tokens = Array.from(new Set(users.map((u) => u.deviceToken).filter(Boolean)));
    if (tokens.length) {
      try {
        await sendNotification(tokens, { title: "Class Cancelled", body }, { type: "trainerCancelled" });
      } catch (e) {
        console.error("[auto-cancel-class] push failed:", e.message);
      }
    }

    const metadata = {
      cycle: `${slot.id}-${todayPkt.format("YYYY-MM-DD")}`,
      classTime: slot.start,
      classType: slot.type || null,
      nextClass: nextLabel,
    };
    for (const id of userIds) {
      try {
        await popupEligibility.setEligible(id, POPUP, new Date(), metadata);
      } catch (e) {
        console.error("[auto-cancel-class] popup failed for user", id, e.message);
      }
    }
}

// Retire cancelled-class popups that are no longer about "today".
async function retireOldClassCancelledPopups() {
  const { PendingPopupState } = require("../models");
  await PendingPopupState.update(
    { completedAt: new Date() },
    {
      where: {
        popupVariable: POPUP,
        completedAt: null,
        eligibleAt: { [Op.lt]: moment().subtract(POPUP_MAX_AGE_HOURS, "hours").toDate() },
      },
    }
  );
}

module.exports = { autoCancelLateClasses, retireOldClassCancelledPopups, announceCancelled, LATE_START_MINUTES };
