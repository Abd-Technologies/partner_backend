// Fit Her payment accounts (where clients pay). See helper/paymentAccounts.js.
//   GET  /users/payment-accounts            active accounts (upload slip screen)
//   GET  /admin/payment-accounts            all accounts (admin)
//   POST /admin/payment-accounts            add            (admin only)
//   POST /admin/payment-accounts/:id        edit / on-off  (admin only)
const ApiResponse = require("../../helper/ApiResponse");
const { isAdmin, adminsOnlyMessage } = require("../../helper/roles");

const M = () => require("../../models");
const FIELDS = ["kind", "provider", "title", "number", "iban", "branch", "swift", "note", "active", "sortOrder"];

function view(a) {
  return {
    id: a.id,
    kind: a.kind,
    provider: a.provider,
    title: a.title,
    number: a.number,
    iban: a.iban,
    branch: a.branch,
    swift: a.swift,
    note: a.note,
    active: !!a.active,
    sortOrder: a.sortOrder,
  };
}

async function actor(req) {
  if (!req.user || !req.user.id) return null;
  return M().User.findByPk(req.user.id, { attributes: ["id", "userType"] });
}

function clean(body) {
  const out = {};
  for (const f of FIELDS) {
    if (body[f] === undefined) continue;
    let v = body[f];
    if (f === "active") v = v === true || v === "true" || v === 1 || v === "1";
    else if (f === "sortOrder") v = parseInt(v, 10) || 0;
    else v = v == null ? null : String(v).trim() || null;
    out[f] = v;
  }
  if (out.kind && !["wallet", "bank"].includes(out.kind)) out.kind = "wallet";
  if (out.number) out.number = out.number.replace(/\s/g, "");
  if (out.iban) out.iban = out.iban.replace(/\s/g, "").toUpperCase();
  return out;
}

exports.listActive = async (req, res) => {
  try {
    const rows = await require("../../helper/paymentAccounts").listActive();
    return res.json(ApiResponse("1", "Payment accounts", { accounts: rows.map(view) }));
  } catch (e) {
    return res.json(ApiResponse("0", e.message, {}));
  }
};

exports.listAll = async (req, res) => {
  const a = await actor(req);
  if (!isAdmin(a)) return res.json(ApiResponse("0", adminsOnlyMessage(a), {}));
  const rows = await M().PaymentAccount.findAll({ order: [["active", "DESC"], ["sortOrder", "ASC"], ["id", "ASC"]] });
  return res.json(ApiResponse("1", "Payment accounts", { accounts: rows.map(view) }));
};

exports.create = async (req, res) => {
  const a = await actor(req);
  if (!isAdmin(a)) return res.json(ApiResponse("0", adminsOnlyMessage(a), {}));
  const data = clean(req.body || {});
  if (!data.provider || !data.title || !data.number) {
    return res.json(ApiResponse("0", "Please add the provider, account title and number.", {}));
  }
  const row = await M().PaymentAccount.create({ ...data, updatedBy: a.id });
  return res.json(ApiResponse("1", "Account added", { account: view(row) }));
};

exports.update = async (req, res) => {
  const a = await actor(req);
  if (!isAdmin(a)) return res.json(ApiResponse("0", adminsOnlyMessage(a), {}));
  const row = await M().PaymentAccount.findByPk(req.params.id);
  if (!row) return res.json(ApiResponse("0", "Account not found", {}));
  const data = clean(req.body || {});
  if (data.title === null || data.number === null || data.provider === null) {
    return res.json(ApiResponse("0", "Provider, title and number can't be empty.", {}));
  }
  await row.update({ ...data, updatedBy: a.id });
  return res.json(ApiResponse("1", "Account saved", { account: view(row) }));
};
