// "Confirm payments" — AI-approved slips the admin must confirm within 48 h.
// See helper/paymentVerify.js.
const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { isAdmin, adminsOnlyMessage } = require("../../helper/roles");
const pv = require("../../helper/paymentVerify");

const M = () => require("../../models");

async function actor(req) {
  if (!req.user || !req.user.id) return null;
  return M().User.findByPk(req.user.id, { attributes: ["id", "userType"] });
}

function ocr(img) {
  let d = img.ocrData;
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch (_) { d = null; }
  }
  return d || {};
}

/** GET /admin/payment-checks — to confirm (oldest first) + paused. */
exports.list = async (req, res) => {
  const a = await actor(req);
  if (!isAdmin(a)) return res.json(ApiResponse("0", adminsOnlyMessage(a), {}));
  const { PlanImage, User, Plan } = M();
  const rows = await PlanImage.findAll({
    where: {
      [Op.or]: [
        { verifyStatus: "pending" },
        { verifyStatus: { [Op.in]: ["held", "not_received"] }, heldAt: { [Op.gte]: new Date(Date.now() - 60 * 86400000) } },
      ],
    },
    order: [["verifyStartedAt", "ASC"]],
    limit: 200,
  });
  const users = await User.findAll({
    where: { id: { [Op.in]: [...new Set(rows.map((r) => r.UserId).filter(Boolean))] } },
    attributes: ["id", "firstName", "lastName", "phone"],
  });
  const plans = await Plan.findAll({
    where: { id: { [Op.in]: [...new Set(rows.map((r) => r.PlanId).filter(Boolean))] } },
    attributes: ["id", "title"],
  });
  const uBy = new Map(users.map((u) => [u.id, u]));
  const pBy = new Map(plans.map((p) => [p.id, p]));
  const now = Date.now();
  const items = rows.map((r) => {
    const d = ocr(r);
    const u = uBy.get(r.UserId);
    const started = r.verifyStartedAt ? new Date(r.verifyStartedAt).getTime() : null;
    // DirectPay (no slip image): check it in the DirectPay merchant portal.
    const directPay = d.method === "directpay";
    return {
      id: r.id,
      method: directPay ? "directpay" : "slip",
      status: r.verifyStatus,
      name: u ? `${u.firstName || ""} ${u.lastName || ""}`.trim() : "—",
      phone: u ? u.phone : null,
      plan: pBy.get(r.PlanId) ? pBy.get(r.PlanId).title : null,
      amount: r.ocrAmount || r.paidAmount || Number(r.price) || null,
      account: d.account || null,
      reference: r.ocrTransactionId || d.refNumber || null,
      slipDate: d.slipDate || r.ocrDate || null,
      image: r.image || null,
      approvedAt: r.verifyStartedAt,
      hoursLeft: started ? Math.max(0, Math.round(pv.HOLD_AFTER_HOURS - (now - started) / 3600000)) : null,
      heldAt: r.heldAt,
      userProof: r.userProof,
    };
  });
  return res.json(ApiResponse("1", "Payment checks", { items }));
};

/** POST /admin/payment-checks/:id { result: 'received' | 'not_received' } */
exports.decide = async (req, res) => {
  const a = await actor(req);
  if (!isAdmin(a)) return res.json(ApiResponse("0", adminsOnlyMessage(a), {}));
  const img = await M().PlanImage.findByPk(req.params.id);
  if (!img || !img.verifyStatus) return res.json(ApiResponse("0", "Payment not found", {}));
  const result = req.body && req.body.result;
  if (result === "received") {
    await pv.confirm(img, a.id);
    return res.json(ApiResponse("1", "Payment confirmed", {}));
  }
  if (result === "not_received") {
    await pv.hold(img, "not_received");
    return res.json(ApiResponse("1", "Plan paused", {}));
  }
  return res.json(ApiResponse("0", "Choose received or not_received", {}));
};

/** GET /users/payment-hold — her red banner (null when nothing is paused). */
exports.myHold = async (req, res) => {
  try {
    const h = await pv.holdFor(req.user.id);
    return res.json(ApiResponse("1", "Payment hold", { hold: h }));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};

/** POST /users/payment-hold/proof { text } — transaction ID / note for admin. */
exports.sendProof = async (req, res) => {
  const text = String((req.body && req.body.text) || "").trim();
  if (text.length < 4) return res.json(ApiResponse("0", "Please add your transaction ID or a short note.", {}));
  const ok = await pv.submitProof(req.user.id, text);
  return res.json(ok ? ApiResponse("1", "Sent to our team", {}) : ApiResponse("0", "Nothing to send proof for", {}));
};
