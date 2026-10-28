// Dietitian "Emergency: cancel my day" (Oct 2026).
//
// Rules
//   • Today or tomorrow only (Pakistan calendar day).
//   • Only sessions not started yet (pending / confirmed). In Progress and
//     completed are left alone.
//   • 2 emergency days a calendar month on her own; the 3rd and later wait
//     for admin approval (status awaiting_approval).
//   • 2-minute undo: the request is "scheduled" and applied by the minute
//     cron when applyAt passes. Undo before then → nothing happens.
// Each cancelled session (same as a dietitian cancel, see
// appointmentController.updateAppointment):
//   • status "canceled" (dietitian-cancelled: never her late change, never
//     counts against her consultations — those only count live/completed rows)
//   • free days on her package, once per session: 3 if the session was less
//     than 24 h away when the dietitian asked, else 1
//   • urgent "consultation cancelled" pop-up (reason dietitian_emergency)
//     + push to her
// Also: her free slots that day are closed (isBlocked, used by
// availability + createAppointment), the 48 h plan-delivery timer is paused
// for her clients for that day (pauseHours), one admin alert with the
// totals and the month's count.
const { Op } = require("sequelize");
const moment = require("moment-timezone");
const sendNotification = require("./notification");
const bookingPolicy = require("./bookingPolicy");

const TZ = "Asia/Karachi";
const UNDO_MINUTES = 2;
const FREE_PER_MONTH = 2;
const DAYS_SHORT_NOTICE = 3; // session < 24 h away
const DAYS_LONG_NOTICE = 1; // session >= 24 h away
const REASONS = { sick: "Sick", family: "Family emergency", tech: "Internet / power problem", other: "Other" };

const M = () => require("../models");

function isoDay(which) {
  const d = moment.tz(TZ);
  if (which === "tomorrow") d.add(1, "day");
  return d.format("YYYY-MM-DD");
}

function toIso(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function fullName(u) {
  return u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "";
}

/** Her not-started sessions on that day, soonest first. */
async function sessionsFor(dietitianId, day) {
  const { Appointment, SlotDiet, User } = M();
  const rows = await Appointment.findAll({
    where: {
      dietitionId: dietitianId,
      date: { [Op.between]: [day, `${day} 23:59:59`] },
      status: { [Op.in]: ["pending", "confirmed"] },
    },
    include: [
      { model: SlotDiet, attributes: ["id", "start", "end"], required: false },
      { model: User, as: "ClientUser", attributes: ["id", "firstName", "lastName"], required: false },
    ],
  });
  const out = [];
  for (const a of rows) {
    if (toIso(a.date) !== day) continue;
    const start = bookingPolicy.sessionStartSync(a, a.SlotDiet);
    out.push({ appt: a, start, client: a.ClientUser || null });
  }
  out.sort((x, y) => (x.start ? x.start.getTime() : 0) - (y.start ? y.start.getTime() : 0));
  return out;
}

async function usedThisMonth(dietitianId) {
  const { DietitianEmergencyDay } = M();
  const from = moment.tz(TZ).startOf("month").format("YYYY-MM-DD");
  const to = moment.tz(TZ).endOf("month").format("YYYY-MM-DD");
  return DietitianEmergencyDay.count({
    where: {
      dietitianId,
      day: { [Op.between]: [from, to] },
      status: { [Op.in]: ["scheduled", "applied", "awaiting_approval"] },
    },
  });
}

/** What the sheet shows before she confirms. */
async function preview(dietitianId, which) {
  const { DietitianEmergencyDay } = M();
  const day = isoDay(which);
  const list = await sessionsFor(dietitianId, day);
  const used = await usedThisMonth(dietitianId);
  const existing = await DietitianEmergencyDay.findOne({
    where: { dietitianId, day, status: { [Op.in]: ["scheduled", "applied", "awaiting_approval"] } },
  });
  return {
    day,
    sessions: list.map((s) => ({
      appointmentId: s.appt.id,
      time: s.start ? bookingPolicy.formatPkTime(s.start) : (s.appt.SlotDiet && s.appt.SlotDiet.start) || null,
      client: s.client ? s.client.firstName || fullName(s.client) : null,
    })),
    usedThisMonth: used,
    freePerMonth: FREE_PER_MONTH,
    needsApproval: used >= FREE_PER_MONTH,
    existing: existing ? existing.toJSON() : null,
    reasons: REASONS,
  };
}

async function adminTokens() {
  const { User } = M();
  const rows = await User.findAll({
    where: { userType: { [Op.like]: "admin%" }, deviceToken: { [Op.ne]: null } },
    attributes: ["deviceToken"],
  });
  return rows.map((r) => r.deviceToken).filter(Boolean);
}

/** Dietitian confirms. Returns { ok, row?, message }. */
async function request(dietitianId, which, reason, note) {
  const { DietitianEmergencyDay, User } = M();
  if (!["today", "tomorrow"].includes(which)) return { ok: false, message: "Pick today or tomorrow." };
  if (!REASONS[reason]) return { ok: false, message: "Pick a reason." };
  const p = await preview(dietitianId, which);
  if (p.existing) return { ok: false, message: "This day is already cancelled or waiting for approval." };
  if (!p.sessions.length) return { ok: false, message: "You have no sessions to cancel on that day." };
  const cleanNote = typeof note === "string" && note.trim() ? note.trim().slice(0, 250) : null;
  if (p.needsApproval) {
    const row = await DietitianEmergencyDay.create({
      dietitianId, day: p.day, reason, note: cleanNote, status: "awaiting_approval",
    });
    const me = await User.findByPk(dietitianId, { attributes: ["firstName", "lastName"] });
    try {
      await require("./escalation").createEscalation({
        userId: dietitianId,
        dietitianId,
        trigger: "DIETITIAN_EMERGENCY_DAY",
        severity: "high",
        payload: { emergencyDayId: row.id, day: p.day, reason: REASONS[reason], note: cleanNote, sessions: p.sessions.length, needsApproval: true },
        copy: {
          title: "Emergency day needs your approval",
          body: `${fullName(me) || "A dietitian"} wants to cancel ${p.sessions.length} session(s) on ${moment(p.day).format("ddd D MMM")} (${REASONS[reason]}). This is her emergency day ${p.usedThisMonth + 1} this month.`,
        },
      });
    } catch (e) {
      console.error("[emergency-day] approval escalation:", e.message);
    }
    return { ok: true, row: row.toJSON(), message: "Sent to the admin for approval. Your clients aren't told until it's approved." };
  }
  const row = await DietitianEmergencyDay.create({
    dietitianId, day: p.day, reason, note: cleanNote, status: "scheduled",
    applyAt: new Date(Date.now() + UNDO_MINUTES * 60000),
  });
  return { ok: true, row: row.toJSON(), message: `Cancelling in ${UNDO_MINUTES} minutes. You can undo until then.` };
}

async function undo(dietitianId, id) {
  const { DietitianEmergencyDay } = M();
  const row = await DietitianEmergencyDay.findByPk(id);
  if (!row || row.dietitianId !== dietitianId) return { ok: false, message: "Not found." };
  if (row.status === "awaiting_approval") {
    row.status = "undone";
    await row.save();
    return { ok: true, message: "Request withdrawn." };
  }
  if (row.status !== "scheduled" || (row.applyAt && new Date(row.applyAt) <= new Date())) {
    return { ok: false, message: "Too late to undo: your clients have been told." };
  }
  row.status = "undone";
  await row.save();
  return { ok: true, message: "Undone. Nothing was cancelled." };
}

/** Cancels the day's sessions. Called by the cron (scheduled) or on approval. */
async function apply(row) {
  const { User } = M();
  const requestedAt = new Date(row.createdAt || Date.now());
  const list = await sessionsFor(row.dietitianId, toIso(row.day));
  const dietitian = await User.findByPk(row.dietitianId, { attributes: ["firstName", "lastName", "deviceToken"] });
  const dName = fullName(dietitian) || "Your dietitian";
  const { queueConsultationCancelled } = require("./consultationCancelledPopup");
  let cancelled = 0;
  let days = 0;
  for (const s of list) {
    const appt = s.appt;
    try {
      if (!["pending", "confirmed"].includes(appt.status)) continue;
      appt.status = "canceled";
      appt.completed_by = row.dietitianId;
      appt.status_changed_at = new Date();
      await appt.save();
      let bonus = 0;
      if (!(appt.noShowBonusDays > 0)) {
        const hoursAway = s.start ? (s.start.getTime() - requestedAt.getTime()) / 3600000 : 0;
        bonus = hoursAway < bookingPolicy.LATE_CHANGE_HOURS ? DAYS_SHORT_NOTICE : DAYS_LONG_NOTICE;
        const plan = await bookingPolicy.planForAppointment(appt);
        if (plan && plan.expireDate) {
          await plan.update({ expireDate: new Date(new Date(plan.expireDate).getTime() + bonus * 86400000) });
          await appt.update({ noShowBonusDays: bonus });
        } else {
          bonus = 0;
        }
      }
      await queueConsultationCancelled(appt, "dietitian_emergency", { bonusDays: bonus });
      const client = await User.findByPk(appt.userId, { attributes: ["deviceToken"] });
      if (client && client.deviceToken) {
        const when = s.start ? bookingPolicy.formatPkTime(s.start) : "";
        await sendNotification(
          [client.deviceToken],
          {
            title: "Your session was cancelled",
            body:
              `${dName} had an emergency and couldn't take your ${when} session. ` +
              (bonus > 0 ? `We've added ${bonus} day${bonus === 1 ? "" : "s"} to your package. ` : "") +
              "Book a new time.",
          },
          { type: "appointmentCanceled" }
        );
      }
      cancelled++;
      days += bonus;
    } catch (e) {
      console.error("[emergency-day] appt", appt.id, e.message);
    }
  }
  row.status = "applied";
  row.appliedAt = new Date();
  row.sessionsCancelled = cancelled;
  row.daysGiven = days;
  await row.save();

  const used = await usedThisMonth(row.dietitianId);
  try {
    await require("./escalation").createEscalation({
      userId: row.dietitianId,
      dietitianId: row.dietitianId,
      trigger: "DIETITIAN_EMERGENCY_DAY",
      severity: "medium",
      payload: { emergencyDayId: row.id, day: toIso(row.day), reason: REASONS[row.reason] || row.reason, note: row.note, sessions: cancelled, daysGiven: days, monthCount: used },
      copy: {
        title: "Emergency day: sessions cancelled",
        body: `${fullName(dietitian) || "A dietitian"} cancelled ${cancelled} session(s) on ${moment(toIso(row.day)).format("ddd D MMM")} (${REASONS[row.reason] || row.reason}). ${cancelled} client(s) told, ${days} day(s) given. Emergency days this month: ${used}.`,
      },
    });
  } catch (e) {
    console.error("[emergency-day] summary escalation:", e.message);
  }
  if (dietitian && dietitian.deviceToken) {
    await sendNotification(
      [dietitian.deviceToken],
      { title: "Your day is cleared", body: `${cancelled} session(s) cancelled and your clients were told. Take care.` },
      { type: "emergencyDayApplied" }
    ).catch(() => {});
  }
  return row;
}

/** Minute cron: apply scheduled rows whose undo window has passed. */
async function applyDue() {
  const { DietitianEmergencyDay } = M();
  const rows = await DietitianEmergencyDay.findAll({
    where: { status: "scheduled", applyAt: { [Op.lte]: new Date() } },
  });
  for (const r of rows) {
    try {
      await apply(r);
    } catch (e) {
      console.error("[emergency-day] apply", r.id, e.message);
    }
  }
  return rows.length;
}

/** Admin: approve (applies now) or reject (she is told). */
async function decide(adminId, id, approve) {
  const { DietitianEmergencyDay, User } = M();
  const row = await DietitianEmergencyDay.findByPk(id);
  if (!row || row.status !== "awaiting_approval") return { ok: false, message: "This request is no longer waiting." };
  row.decidedBy = adminId;
  if (!approve) {
    row.status = "rejected";
    await row.save();
    const d = await User.findByPk(row.dietitianId, { attributes: ["deviceToken"] });
    if (d && d.deviceToken) {
      await sendNotification(
        [d.deviceToken],
        { title: "Emergency day not approved", body: `Your sessions on ${moment(toIso(row.day)).format("ddd D MMM")} stay as booked. Please contact the admin.` },
        { type: "emergencyDayRejected" }
      ).catch(() => {});
    }
    return { ok: true, message: "Rejected. Her sessions stay as booked." };
  }
  await row.save();
  await apply(row);
  return { ok: true, message: `Approved: ${row.sessionsCancelled} session(s) cancelled, ${row.daysGiven} day(s) given.` };
}

async function listAwaiting() {
  const { DietitianEmergencyDay, User } = M();
  const rows = await DietitianEmergencyDay.findAll({ where: { status: "awaiting_approval" }, order: [["createdAt", "ASC"]] });
  const out = [];
  for (const r of rows) {
    const d = await User.findByPk(r.dietitianId, { attributes: ["firstName", "lastName"] });
    const s = await sessionsFor(r.dietitianId, toIso(r.day));
    out.push({
      id: r.id,
      dietitian: fullName(d) || `Dietitian #${r.dietitianId}`,
      day: toIso(r.day),
      reason: REASONS[r.reason] || r.reason,
      note: r.note,
      sessions: s.length,
      monthCount: await usedThisMonth(r.dietitianId),
      requestedAt: r.createdAt,
    });
  }
  return out;
}

/** Her free slots are closed on an emergency day (applied or in the undo window). */
async function isBlocked(dietitianId, day) {
  const { DietitianEmergencyDay } = M();
  if (!DietitianEmergencyDay) return false;
  const n = await DietitianEmergencyDay.count({
    where: { dietitianId, day: toIso(day), status: { [Op.in]: ["scheduled", "applied"] } },
  });
  return n > 0;
}

async function blockedDays(dietitianId, from, to) {
  const { DietitianEmergencyDay } = M();
  if (!DietitianEmergencyDay) return new Set();
  const rows = await DietitianEmergencyDay.findAll({
    where: { dietitianId, day: { [Op.between]: [from, to] }, status: { [Op.in]: ["scheduled", "applied"] } },
    attributes: ["day"],
  });
  return new Set(rows.map((r) => toIso(r.day)));
}

/** Hours to take off the 48 h plan-delivery clock: 24 per emergency day since `since`. */
async function pauseHours(dietitianId, since) {
  const { DietitianEmergencyDay } = M();
  if (!dietitianId || !DietitianEmergencyDay) return 0;
  const n = await DietitianEmergencyDay.count({
    where: {
      dietitianId,
      status: "applied",
      day: { [Op.between]: [moment.tz(since, TZ).format("YYYY-MM-DD"), moment.tz(TZ).format("YYYY-MM-DD")] },
    },
  });
  return n * 24;
}

module.exports = {
  preview, request, undo, apply, applyDue, decide, listAwaiting,
  isBlocked, blockedDays, pauseHours,
  UNDO_MINUTES, FREE_PER_MONTH, DAYS_SHORT_NOTICE, DAYS_LONG_NOTICE, REASONS,
};
