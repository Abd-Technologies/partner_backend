const express = require("express");
const router = express.Router();

const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/Admin/escalationAdminController");

// GET  /admin/escalations            — list (filterable by status/trigger)
// POST /admin/escalations/:id/resolve — close a ticket
router.get("/", validateAdmin, asyncMiddleware(ctrl.listTickets));
router.post(
  "/:id/resolve",
  validateAdmin,
  asyncMiddleware(ctrl.resolveTicket)
);

module.exports = router;
