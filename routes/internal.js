const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/FrontSite/appNotifyController");
const { verifyCrmInternal } = require("../helper/crmSignature");

// Server-to-server endpoints (CRM → app backend), NOT user tokens. All are
// HMAC-signed by the CRM (helper/crmSignature.js). The two below also accept
// the old x-internal-secret header until ALLOW_LEGACY_INTERNAL_SECRET=false.

// POST /internal/app-notify — push a message to a user's device (e.g. issue resolved)
router.post("/app-notify", verifyCrmInternal, ctrl.appNotify);

// POST /internal/support-ticket-update — CRM replies to / resolves a support ticket
const supportCrm = require("../controllers/FrontSite/supportCrmController");
router.post("/support-ticket-update", verifyCrmInternal, supportCrm.supportTicketUpdate);

// Support tickets for the CRM's sales reps (Nov 2026). HMAC-signed by the
// CRM (helper/crmSignature.js); acts as a sales rep: list, view, reply.
// GET  /internal/crm/support-tickets?status=open|overdue|resolved
// GET  /internal/crm/support-tickets/:id
// POST /internal/crm/support-tickets/:id/reply   { message, agent_name }
const { verifyCrmSigned } = require("../helper/crmSignature");
const tickets = require("../controllers/Admin/supportTicketAdminController");
const asyncMiddleware = require("../middlewares/async");
router.get("/crm/support-tickets", verifyCrmSigned, asyncMiddleware(tickets.listTickets));
router.get("/crm/support-tickets/:id", verifyCrmSigned, asyncMiddleware(tickets.getTicket));
router.post("/crm/support-tickets/:id/reply", verifyCrmSigned, asyncMiddleware(tickets.replyTicket));

// Payment links from the CRM (Nov 2026): plans list + create a magic link,
// signed by the CRM, acting as the rep (works whichever way she logged in).
// GET  /internal/crm/plans
// POST /internal/crm/magic-links   { PlanId, PriceDurationId, phone, crmLeadId, ..., partner_user_id? }
router.get("/crm/plans", verifyCrmSigned, asyncMiddleware(require("../controllers/Admin/AdminController").get_plans_admin));
router.post("/crm/magic-links", verifyCrmSigned, asyncMiddleware(require("../controllers/FrontSite/magicLinkController").createLink));
// POST /internal/crm/payment-slips  { token, image_base64, mime?, app_user_id? }
// She sent the slip on WhatsApp: check it against the rep's payment request.
router.post("/crm/payment-slips", verifyCrmSigned, asyncMiddleware(require("../controllers/FrontSite/magicLinkController").redeemFromCrm));

// GET /internal/crm/customers — every customer account (id, phone, email,
// signed-up date), for the CRM's duplicate / missing-lead report (signed).
//
// Optional ?limit=&offset= (Nov 2026). Both default to "everything", so every
// existing caller is unaffected. The CRM's one-time backfill walks the list in
// pages rather than asking for the whole table in a single response.
// GET  /internal/crm/payment-claims?app_user_id=&phone=&email=  — WhatsApp
//      payments for her: link + slip state (why didn't her plan start?).
// POST /internal/crm/payment-claims/run { app_user_id } — attach her waiting
//      slips and start the plan now (same code as signup); returns the result.
router.get("/crm/payment-claims", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const { MagicPaymentLink, PlanImage } = require("../models");
  const { Op } = require("sequelize");
  const tail = String(req.query.phone || "").replace(/\D/g, "").slice(-10);
  const email = String(req.query.email || "").trim().toLowerCase();
  const uid = parseInt(req.query.app_user_id, 10) || null;
  const or = [];
  if (uid) or.push({ UserId: uid });
  if (tail.length === 10) or.push({ phone: { [Op.like]: `%${tail}` } });
  if (email.includes("@")) or.push({ email });
  if (!or.length) return res.json(require("../helper/ApiResponse")("0", "app_user_id, phone or email required", {}));
  const links = await MagicPaymentLink.findAll({ where: { [Op.or]: or }, order: [["id", "DESC"]], limit: 20 });
  const out = [];
  for (const l of links) {
    const img = l.redeemedPlanImageId ? await PlanImage.findByPk(l.redeemedPlanImageId) : null;
    const d = img && img.ocrData && typeof img.ocrData === "object" ? img.ocrData : {};
    out.push({
      link_id: l.id, status: l.status, phone: l.phone, email: l.email || null, link_user: l.UserId, paid: l.paidAmount,
      slip: img ? {
        id: img.id, user: img.UserId, status: img.status, waitingForSignup: d.waitingForSignup ?? null,
        planStartedAt: d.planStartedAt || null, autoApproved: d.autoApproved ?? null, reason: d.approvalReason || null,
        ocrDataType: typeof img.getDataValue("ocrData"),
      } : null,
    });
  }
  res.json(require("../helper/ApiResponse")("1", "Payment claims", { links: out }));
}));
router.post("/crm/payment-claims/run", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const { User } = require("../models");
  const u = await User.findOne({ where: { id: parseInt(req.body?.app_user_id, 10) || 0 }, attributes: ["id", "phone", "email", "userType"], raw: true });
  if (!u) return res.json(require("../helper/ApiResponse")("0", "App user not found", {}));
  const r = await require("../helper/paymentClaims").claimFor(u);
  res.json(require("../helper/ApiResponse")("1", r.started ? "Plan started" : r.claimed ? "Slip attached" : "Nothing to start", r));
}));

// POST /internal/crm/test-reset { phone, email? } — TEST ONLY (Nov 2026).
// Wipes one test customer so the WhatsApp → payment → signup flow can be
// run again: her app account(s) + plans, every payment link for the phone /
// email and the slips on them. Refused unless the phone is listed in
// TEST_RESET_PHONES (comma list) in this backend's .env.
router.post("/crm/test-reset", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const R = require("../helper/ApiResponse");
  const { Op } = require("sequelize");
  const { User, UserPlan, MagicPaymentLink, PlanImage } = require("../models");
  const tail = String(req.body?.phone || "").replace(/\D/g, "").slice(-10);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const allowed = String(process.env.TEST_RESET_PHONES || "").split(",").map((p) => p.replace(/\D/g, "").slice(-10)).filter(Boolean);
  if (tail.length !== 10 || !allowed.includes(tail)) {
    return res.json(R("0", "Not a test number (add it to TEST_RESET_PHONES in the app backend .env)", {}));
  }
  const userOr = [{ phone: { [Op.like]: `%${tail}` } }];
  if (email.includes("@")) userOr.push({ email });
  const users = (await User.findAll({ where: { [Op.or]: userOr, userType: { [Op.in]: ["User", "user"] } }, attributes: ["id", "phone", "email"] }))
    .filter((u) => String(u.phone || "").replace(/\D/g, "").endsWith(tail) || (email && String(u.email || "").toLowerCase() === email));
  const userIds = users.map((u) => u.id);
  const linkOr = [{ phone: { [Op.like]: `%${tail}` } }];
  if (email.includes("@")) linkOr.push({ email });
  if (userIds.length) linkOr.push({ UserId: { [Op.in]: userIds } });
  const links = await MagicPaymentLink.findAll({ where: { [Op.or]: linkOr } });
  const linkIds = links.map((l) => l.id);
  const imgOr = [];
  if (linkIds.length) imgOr.push({ magicPaymentLinkId: { [Op.in]: linkIds } });
  const redeemed = links.map((l) => l.redeemedPlanImageId).filter(Boolean);
  if (redeemed.length) imgOr.push({ id: { [Op.in]: redeemed } });
  if (userIds.length) imgOr.push({ UserId: { [Op.in]: userIds } });
  const out = { users: userIds, payment_links: linkIds.length, slips: 0, plans: 0, errors: [] };
  if (imgOr.length) out.slips = await PlanImage.destroy({ where: { [Op.or]: imgOr } }).catch((e) => { out.errors.push(`slips: ${e.message}`); return 0; });
  if (linkIds.length) await MagicPaymentLink.destroy({ where: { id: { [Op.in]: linkIds } } }).catch((e) => out.errors.push(`links: ${e.message}`));
  if (userIds.length) out.plans = await UserPlan.destroy({ where: { userId: { [Op.in]: userIds } } }).catch((e) => { out.errors.push(`plans: ${e.message}`); return 0; });
  // Everything else that points at her account (cycle data, check-ins,
  // screening, chat…) goes first, or the account row can't be deleted.
  if (userIds.length) {
    const seq = User.sequelize;
    const [refs] = await seq.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'Users' AND TABLE_NAME <> 'Users'`
    );
    out.child_rows = {};
    for (let pass = 0; pass < 3; pass++) { // a few passes: children of children
      for (const { t, c } of refs) {
        try {
          const [r] = await seq.query(`DELETE FROM \`${t}\` WHERE \`${c}\` IN (:ids)`, { replacements: { ids: userIds } });
          const n = r?.affectedRows ?? 0;
          if (n) out.child_rows[`${t}.${c}`] = (out.child_rows[`${t}.${c}`] || 0) + n;
        } catch (_) { /* a grandchild still points here — next pass */ }
      }
    }
  }
  for (const u of users) {
    await u.destroy().catch((e) => out.errors.push(`user ${u.id}: ${e.message}`));
  }
  console.log("🧪 [test-reset]", tail, out);
  res.json(R(out.errors.length ? "0" : "1", out.errors.length ? `Partly reset: ${out.errors.join("; ").slice(0, 400)}` : "Reset", out));
}));

router.get("/crm/customers", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const { User } = require("../models");
  const { Op } = require("sequelize");

  const rawLimit = parseInt(req.query.limit, 10);
  const rawOffset = parseInt(req.query.offset, 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 2000) : null;
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  // Optional lookup (Nov 2026): ?phone= matches the last 10 digits, ?email=
  // matches case-insensitively; both given → either one matches.
  const where = { userType: { [Op.in]: ["User", "user"] } };
  const phone10 = String(req.query.phone || "").replace(/\D/g, "").slice(-10);
  const email = String(req.query.email || "").trim().toLowerCase();
  const either = [];
  if (phone10.length === 10) either.push({ phone: { [Op.like]: `%${phone10}` } });
  if (email.includes("@")) either.push(require("sequelize").where(require("sequelize").fn("LOWER", require("sequelize").col("email")), email));
  if (either.length) where[Op.or] = either;

  const query = {
    where,
    attributes: ["id", "phone", "email", "firstName", "lastName", "createdAt"],
    order: [["id", "ASC"]],
    raw: true,
  };
  if (limit !== null) {
    query.limit = limit;
    query.offset = offset;
  }

  const rows = await User.findAll(query);
  res.json(require("../helper/ApiResponse")("1", "Customers", {
    count: rows.length,
    offset,
    limit: limit,
    customers: rows,
  }));
}));

// GET /internal/crm/subscriptions?limit=&offset= — every customer's current
// plan state (signed), for the CRM's nightly sync. helper/subscriptionState.js
router.get("/crm/subscriptions", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const data = await require("../helper/subscriptionState").page({ limit: req.query.limit, offset: req.query.offset });
  res.json(require("../helper/ApiResponse")("1", "Subscriptions", data));
}));

// GET /internal/crm/outbox?limit=20 — CRM event queue status (signed).
router.get("/crm/outbox", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const data = await require("../helper/crmEvents").recent(parseInt(req.query.limit, 10) || 20);
  res.json(require("../helper/ApiResponse")("1", "CRM outbox", data));
}));

// Old (no-expiry) app logins, for the CRM admin page (signed).
//   GET  /internal/crm/legacy-tokens         who still uses them, cutoff, days left
//   POST /internal/crm/legacy-tokens/notify  push "please update the app" to them
router.get("/crm/legacy-tokens", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  res.json(require("../helper/ApiResponse")("1", "Legacy token users", await require("../helper/legacyTokens").list()));
}));
router.post("/crm/legacy-tokens/notify", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const data = await require("../helper/legacyTokens").notify();
  res.json(require("../helper/ApiResponse")("1", `Update reminder sent to ${data.sent} user(s)`, data));
}));

module.exports = router;
