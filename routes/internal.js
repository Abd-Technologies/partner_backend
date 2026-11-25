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

// GET /internal/crm/customers — every customer account (id, phone, email,
// signed-up date), for the CRM's duplicate / missing-lead report (signed).
//
// Optional ?limit=&offset= (Nov 2026). Both default to "everything", so every
// existing caller is unaffected. The CRM's one-time backfill walks the list in
// pages rather than asking for the whole table in a single response.
router.get("/crm/customers", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const { User } = require("../models");
  const { Op } = require("sequelize");

  const rawLimit = parseInt(req.query.limit, 10);
  const rawOffset = parseInt(req.query.offset, 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 2000) : null;
  const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  const query = {
    where: { userType: { [Op.in]: ["User", "user"] } },
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

// GET /internal/crm/outbox?limit=20 — CRM event queue status (signed).
router.get("/crm/outbox", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const data = await require("../helper/crmEvents").recent(parseInt(req.query.limit, 10) || 20);
  res.json(require("../helper/ApiResponse")("1", "CRM outbox", data));
}));

module.exports = router;
