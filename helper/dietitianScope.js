const { DietPlan, UserPlan, Plan, Appointment } = require("../models");

// "A dietitian's clients" isn't one column anywhere in the schema — a
// client can be tied to a dietitian via an active DietPlan, a UserPlan's
// own dietitianId (legacy admin-assignment flow), a UserPlan's Plan
// (package-level assignment), or — last resort — an Appointment. This
// mirrors the derivation in day7ReviewController.js::resolveDietitianId
// (used when WRITING an escalation) but in reverse: given a dietitian,
// find every client that resolves back to her by any of those paths.
//
// Used to scope admin-side endpoints so one dietitian (or any other
// non-User, non-Admin staff type — Trainer/Gynecologist/Psychiatrist)
// can't read another dietitian's clients just by knowing or guessing a
// userId/dietitianId in the URL. See lib/docs/diet_system_full_audit.md's
// "per-dietitian data scoping" finding and Command Center punch-list
// item 2 — validateAdmin only checks "not a plain User", it never checks
// WHICH staff member is asking.
//
// Deliberately not filtered by DietPlan.status — a dietitian who was
// ever assigned to a client (even one whose plan later expired or was
// cancelled) should still be able to see that client's history; this
// is an access-control floor, not a "currently active clients" query.
async function getAssignedClientIds(dietitianId) {
  const id = Number(dietitianId);
  if (!Number.isInteger(id) || id <= 0) return new Set();

  const [viaDietPlan, viaUserPlan, viaPlan, viaAppointment] =
    await Promise.all([
      DietPlan.findAll({
        where: { dietitianId: id },
        attributes: ["userId"],
        raw: true,
      }),
      UserPlan.findAll({
        where: { dietitianId: id },
        attributes: ["userId"],
        raw: true,
      }),
      UserPlan.findAll({
        attributes: ["userId"],
        include: [
          {
            model: Plan,
            attributes: [],
            where: { dietitianId: id },
            required: true,
          },
        ],
        raw: true,
      }),
      Appointment.findAll({
        where: { dietitionId: id },
        attributes: ["userId"],
        raw: true,
      }),
    ]);

  const ids = new Set();
  for (const rows of [viaDietPlan, viaUserPlan, viaPlan, viaAppointment]) {
    for (const r of rows) {
      if (r.userId != null) ids.add(Number(r.userId));
    }
  }
  return ids;
}

// True for any staff type that should see everything rather than being
// scoped to their own clients. Kept as a single named check (rather than
// a negation of "User") so it's an explicit allow-list if more admin-ish
// roles are ever added.
function isUnscopedRole(userType) {
  return userType === "Admin";
}

module.exports = { getAssignedClientIds, isUnscopedRole };
