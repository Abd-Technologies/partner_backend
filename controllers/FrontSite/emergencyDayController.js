// Dietitian "Emergency: cancel my day" endpoints (Oct 2026). Rules in
// helper/emergencyDay.js.
const ApiResponse = require("../../helper/ApiResponse");
const { isAdmin, isStaff, adminsOnlyMessage } = require("../../helper/roles");
const { User } = require("../../models");
const ed = require("../../helper/emergencyDay");

async function me(req) {
  if (!req.user || !req.user.id) return null;
  return User.findByPk(req.user.id, { attributes: ["id", "userType"] });
}

// GET /emergency-day/preview?day=today|tomorrow  (dietitian)
exports.preview = async (req, res) => {
  const u = await me(req);
  if (!u || !isStaff(u)) return res.json(ApiResponse("0", "Dietitians only.", {}));
  const which = req.query.day === "tomorrow" ? "tomorrow" : "today";
  return res.json(ApiResponse("1", "Emergency day preview", await ed.preview(u.id, which)));
};

// POST /emergency-day { day: today|tomorrow, reason, note }  (dietitian)
exports.request = async (req, res) => {
  const u = await me(req);
  if (!u || !isStaff(u)) return res.json(ApiResponse("0", "Dietitians only.", {}));
  const b = req.body || {};
  const r = await ed.request(u.id, b.day, b.reason, b.note);
  return res.json(ApiResponse(r.ok ? "1" : "0", r.message, { request: r.row || null, undoMinutes: ed.UNDO_MINUTES }));
};

// POST /emergency-day/:id/undo  (dietitian)
exports.undo = async (req, res) => {
  const u = await me(req);
  if (!u) return res.json(ApiResponse("0", "Please log in again.", {}));
  const r = await ed.undo(u.id, parseInt(req.params.id, 10));
  return res.json(ApiResponse(r.ok ? "1" : "0", r.message, {}));
};

// GET /emergency-day/awaiting  (admin)
exports.awaiting = async (req, res) => {
  const u = await me(req);
  if (!isAdmin(u)) return res.json(ApiResponse("0", adminsOnlyMessage(u), {}));
  return res.json(ApiResponse("1", "Emergency days awaiting approval", { items: await ed.listAwaiting() }));
};

// POST /emergency-day/:id/decide { approve: true|false }  (admin)
exports.decide = async (req, res) => {
  const u = await me(req);
  if (!isAdmin(u)) return res.json(ApiResponse("0", adminsOnlyMessage(u), {}));
  const approve = (req.body || {}).approve === true || (req.body || {}).approve === "true";
  const r = await ed.decide(u.id, parseInt(req.params.id, 10), approve);
  return res.json(ApiResponse(r.ok ? "1" : "0", r.message, {}));
};
