const express = require("express");
const router = express.Router();

const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/Admin/supportTicketAdminController");

// Support tickets from "Report an issue". userType "Admin" only (checked in
// the controller, since validateAdmin lets every staff type through).
//
// GET  /admin/support-tickets              list (status, category, q, page)
// GET  /admin/support-tickets/counts       counts for menu badges
// GET  /admin/support-tickets/:id          ticket + user + plan + thread
// POST /admin/support-tickets/:id/reply    { message, status? }
// POST /admin/support-tickets/:id/status   { status }
router.get("/", validateAdmin, asyncMiddleware(ctrl.listTickets));
router.get("/counts", validateAdmin, asyncMiddleware(ctrl.getCounts));
router.get("/:id", validateAdmin, asyncMiddleware(ctrl.getTicket));
router.post("/:id/reply", validateAdmin, asyncMiddleware(ctrl.replyTicket));
router.post("/:id/status", validateAdmin, asyncMiddleware(ctrl.setStatus));

module.exports = router;
