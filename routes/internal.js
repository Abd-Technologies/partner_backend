const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/FrontSite/appNotifyController");

// Server-to-server endpoints (CRM → app backend). Auth is via the shared
// x-internal-secret header inside each controller, NOT a user token.

// POST /internal/app-notify — push a message to a user's device (e.g. issue resolved)
router.post("/app-notify", ctrl.appNotify);

// POST /internal/support-ticket-update — CRM replies to / resolves a support ticket
const supportCrm = require("../controllers/FrontSite/supportCrmController");
router.post("/support-ticket-update", supportCrm.supportTicketUpdate);

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
router.get("/crm/customers", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const { User } = require("../models");
  const { Op } = require("sequelize");
  const rows = await User.findAll({
    where: { userType: { [Op.in]: ["User", "user"] } },
    attributes: ["id", "phone", "email", "firstName", "lastName", "createdAt"],
    order: [["id", "ASC"]],
    raw: true,
  });
  res.json(require("../helper/ApiResponse")("1", "Customers", { count: rows.length, customers: rows }));
}));

// GET /internal/crm/outbox?limit=20 — CRM event queue status (signed).
router.get("/crm/outbox", verifyCrmSigned, asyncMiddleware(async (req, res) => {
  const data = await require("../helper/crmEvents").recent(parseInt(req.query.limit, 10) || 20);
  res.json(require("../helper/ApiResponse")("1", "CRM outbox", data));
}));

module.exports = router;
