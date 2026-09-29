const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { User, SupportTicket, SupportTicketMessage } = require("../../models");
const {
  STATUSES,
  CATEGORIES,
  fullName,
  getUserPlan,
  applyStaffReply,
  sendToCrm,
  ticketJson,
} = require("../../helper/supportTickets");

// validateAdmin lets every staff type through (dietitians, trainers...).
// Support tickets are for userType "Admin" only.
function isAdmin(req) {
  return req.user && req.user.userType === "Admin";
}

/**
 * GET /admin/support-tickets
 * Query: status (received|in_review|resolved|open|overdue|all, default open),
 *        category, q (name / phone / email / ticket id), page (1..), limit (<=100)
 * Open tickets come oldest first so nothing gets missed; resolved newest first.
 */
exports.listTickets = async (req, res) => {
  if (!isAdmin(req)) return res.json(ApiResponse("0", "Only Admin can see support tickets", {}));

  const status = String(req.query.status || "open");
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const where = {};

  if (STATUSES.includes(status)) where.status = status;
  else if (status === "open") where.status = { [Op.ne]: "resolved" };
  else if (status === "overdue") {
    where.status = { [Op.ne]: "resolved" };
    where.dueAt = { [Op.lt]: new Date() };
  }

  const category = String(req.query.category || "").toUpperCase();
  if (CATEGORIES.includes(category)) where.category = category;

  const q = String(req.query.q || "").trim();
  if (q) {
    const or = [];
    if (/^\d+$/.test(q)) or.push({ id: parseInt(q, 10) });
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { firstName: { [Op.like]: `%${q}%` } },
          { lastName: { [Op.like]: `%${q}%` } },
          { phone: { [Op.like]: `%${q}%` } },
          { email: { [Op.like]: `%${q}%` } },
        ],
      },
      attributes: ["id"],
      limit: 200,
    });
    if (users.length) or.push({ userId: users.map((u) => u.id) });
    if (!or.length) {
      return res.json(ApiResponse("1", "Tickets", { tickets: [], total: 0, page, counts: await counts() }));
    }
    where[Op.or] = or;
  }

  const oldestFirst = status !== "resolved" && status !== "all";
  const { rows, count } = await SupportTicket.findAndCountAll({
    where,
    order: oldestFirst ? [["createdAt", "ASC"]] : [["lastActivityAt", "DESC"]],
    limit,
    offset: (page - 1) * limit,
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = userIds.length
    ? await User.findAll({
        where: { id: userIds },
        attributes: ["id", "firstName", "lastName", "phone", "email"],
      })
    : [];
  const byId = {};
  users.forEach((u) => { byId[u.id] = u; });

  return res.json(
    ApiResponse("1", "Tickets", {
      tickets: rows.map((t) => ticketJson(t, { client: byId[t.userId] || null })),
      total: count,
      page,
      counts: await counts(),
    })
  );
};

async function counts() {
  const [received, in_review, resolved, overdue, unread] = await Promise.all([
    SupportTicket.count({ where: { status: "received" } }),
    SupportTicket.count({ where: { status: "in_review" } }),
    SupportTicket.count({ where: { status: "resolved" } }),
    SupportTicket.count({ where: { status: { [Op.ne]: "resolved" }, dueAt: { [Op.lt]: new Date() } } }),
    SupportTicket.count({ where: { adminUnread: true } }),
  ]);
  return { received, in_review, resolved, open: received + in_review, overdue, unread };
}

// GET /admin/support-tickets/counts — for a badge on the admin menu.
exports.getCounts = async (req, res) => {
  if (!isAdmin(req)) return res.json(ApiResponse("0", "Only Admin can see support tickets", {}));
  return res.json(ApiResponse("1", "Counts", { counts: await counts() }));
};

// GET /admin/support-tickets/:id — ticket, user details, plan and full thread.
exports.getTicket = async (req, res) => {
  if (!isAdmin(req)) return res.json(ApiResponse("0", "Only Admin can see support tickets", {}));
  const ticket = await SupportTicket.findByPk(parseInt(req.params.id, 10));
  if (!ticket) return res.json(ApiResponse("0", "Ticket not found", {}));
  if (ticket.adminUnread) {
    ticket.adminUnread = false;
    await ticket.save();
  }
  const [client, plan, messages] = await Promise.all([
    User.findByPk(ticket.userId, { attributes: ["id", "firstName", "lastName", "phone", "email"] }),
    getUserPlan(ticket.userId),
    SupportTicketMessage.findAll({ where: { ticketId: ticket.id }, order: [["id", "ASC"]] }),
  ]);
  return res.json(ApiResponse("1", "Ticket", { ticket: ticketJson(ticket, { messages, client, plan }) }));
};

// POST /admin/support-tickets/:id/reply  { message, status? }
// Sends the reply to the user (push + shows in the app) and tells the CRM.
exports.replyTicket = async (req, res) => {
  if (!isAdmin(req)) return res.json(ApiResponse("0", "Only Admin can reply", {}));
  const ticket = await SupportTicket.findByPk(parseInt(req.params.id, 10));
  if (!ticket) return res.json(ApiResponse("0", "Ticket not found", {}));

  const me = await User.findByPk(req.user.id, { attributes: ["id", "firstName", "lastName"] });
  const first = me && me.firstName ? String(me.firstName).trim() : "";
  const senderName = first ? `${first}, FitHer Support` : "FitHer Support";

  const out = await applyStaffReply(ticket, {
    body: req.body && req.body.message,
    status: req.body && req.body.status,
    sender: "admin",
    senderId: req.user.id,
    senderName,
  });
  if (!out.ok) return res.json(ApiResponse("0", "Write a reply or pick a status", {}));

  sendToCrm("support_issue_admin_update", {
    ticket_id: ticket.id,
    app_user_id: String(ticket.userId),
    message: (req.body && req.body.message) || null,
    status: ticket.status,
    agent_name: fullName(me),
    external_event_id: `ticket_${ticket.id}_admin_${Date.now()}`,
  });

  const messages = await SupportTicketMessage.findAll({ where: { ticketId: ticket.id }, order: [["id", "ASC"]] });
  return res.json(ApiResponse("1", "Reply sent", { ticket: ticketJson(ticket, { messages }) }));
};

// POST /admin/support-tickets/:id/status  { status }
exports.setStatus = async (req, res) => {
  if (!isAdmin(req)) return res.json(ApiResponse("0", "Only Admin can update tickets", {}));
  const status = req.body && req.body.status;
  if (!STATUSES.includes(status)) return res.json(ApiResponse("0", "Unknown status", {}));
  const ticket = await SupportTicket.findByPk(parseInt(req.params.id, 10));
  if (!ticket) return res.json(ApiResponse("0", "Ticket not found", {}));
  const me = await User.findByPk(req.user.id, { attributes: ["id", "firstName", "lastName"] });
  await applyStaffReply(ticket, { status, sender: "admin", senderId: req.user.id });
  sendToCrm("support_issue_admin_update", {
    ticket_id: ticket.id,
    app_user_id: String(ticket.userId),
    status: ticket.status,
    agent_name: fullName(me),
    external_event_id: `ticket_${ticket.id}_admin_${Date.now()}`,
  });
  return res.json(ApiResponse("1", "Status updated", { ticket: ticketJson(ticket) }));
};
