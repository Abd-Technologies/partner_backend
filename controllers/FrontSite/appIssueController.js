const ApiResponse = require("../../helper/ApiResponse");
const { User, SupportTicket, SupportTicketMessage } = require("../../models");
const {
  CATEGORIES,
  addWorkingDays,
  fullName,
  getUserPlan,
  publicUrl,
  sendToCrm,
  ticketJson,
} = require("../../helper/supportTickets");

/**
 * reportIssue — POST /users/app-issue
 *
 * Saves the report as a SupportTicket (so the user can follow it and Admin can
 * answer it), then relays it to the CRM as before (`support_issue` webhook).
 * The CRM can answer back through POST /internal/support-ticket-update.
 *
 * Body (multipart/form-data):
 *   message   — text description (required unless an image is attached)
 *   category  — APP_ISSUE | CLASS | PAYMENT | PLAN | ACCOUNT | OTHER | MEDICAL
 *   image     — optional screenshot file (field name "image")
 */
exports.reportIssue = async (req, res) => {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));

    const message = (req.body && req.body.message ? String(req.body.message) : "").trim().slice(0, 1000);
    const rawCat = req.body && req.body.category ? String(req.body.category).toUpperCase() : "APP_ISSUE";
    const category = CATEGORIES.includes(rawCat) ? rawCat : "OTHER";
    const imageUrl = req.file ? publicUrl(req.file.filename) : null;

    if (!message && !imageUrl) {
      return res.json(ApiResponse("0", "Please describe the issue or attach a screenshot.", {}));
    }

    const now = new Date();
    const ticket = await SupportTicket.create({
      userId,
      category,
      message,
      imageUrl,
      status: "received",
      dueAt: addWorkingDays(now, 3),
      lastActivityAt: now,
      userUnread: false,
      adminUnread: true,
    });

    let user = null;
    try { user = await User.findByPk(userId); } catch (_) { /* non-fatal */ }
    const plan = await getUserPlan(userId);

    const synced = await sendToCrm("support_issue", {
      ticket_id: ticket.id,
      app_user_id: String(userId),
      message,
      category,
      priority: category === "MEDICAL" ? "high" : "normal",
      image_url: imageUrl,
      phone: (user && user.phone) || null,
      email: (user && user.email) || null,
      name: fullName(user),
      plan,
      due_at: ticket.dueAt,
      external_event_id: `ticket_${ticket.id}`,
    });
    if (synced) {
      ticket.crmSynced = true;
      await ticket.save();
    }

    return res.json(
      ApiResponse("1", "Your issue has been sent to our team.", {
        ticket: ticketJson(ticket),
        image_url: imageUrl,
      })
    );
  } catch (err) {
    console.error("[appIssue] reportIssue:", err.message);
    return res.json(ApiResponse("0", "Failed to send your issue. Please try again.", {}));
  }
};

// GET /users/app-issue/mine — her tickets, newest activity first.
exports.myTickets = async (req, res) => {
  const userId = req.user && req.user.id;
  if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));
  const rows = await SupportTicket.findAll({
    where: { userId },
    order: [["lastActivityAt", "DESC"], ["id", "DESC"]],
    limit: 50,
  });
  const ids = rows.map((r) => r.id);
  const lastStaff = {};
  if (ids.length) {
    const msgs = await SupportTicketMessage.findAll({
      where: { ticketId: ids },
      order: [["id", "DESC"]],
    });
    msgs.forEach((m) => {
      if (m.sender !== "user" && !lastStaff[m.ticketId]) lastStaff[m.ticketId] = m;
    });
  }
  const tickets = rows.map((t) => {
    const j = ticketJson(t);
    const m = lastStaff[t.id];
    j.lastReply = m ? { senderName: m.senderName, body: m.body, createdAt: m.createdAt } : null;
    return j;
  });
  const unread = rows.filter((t) => t.userUnread).length;
  return res.json(ApiResponse("1", "Tickets", { tickets, unread }));
};

// GET /users/app-issue/unread-count — for the badge on the profile menu.
exports.unreadCount = async (req, res) => {
  const userId = req.user && req.user.id;
  if (!userId) return res.json(ApiResponse("0", "Unauthorized", {}));
  const unread = await SupportTicket.count({ where: { userId, userUnread: true } });
  return res.json(ApiResponse("1", "Unread", { unread }));
};

async function ownTicket(req) {
  const userId = req.user && req.user.id;
  const id = parseInt(req.params.id, 10);
  if (!userId || !id) return null;
  return SupportTicket.findOne({ where: { id, userId } });
}

// GET /users/app-issue/:id — full thread. Opening it clears the red dot.
exports.getTicket = async (req, res) => {
  const ticket = await ownTicket(req);
  if (!ticket) return res.json(ApiResponse("0", "Ticket not found", {}));
  if (ticket.userUnread) {
    ticket.userUnread = false;
    await ticket.save();
  }
  const messages = await SupportTicketMessage.findAll({
    where: { ticketId: ticket.id },
    order: [["id", "ASC"]],
  });
  return res.json(ApiResponse("1", "Ticket", { ticket: ticketJson(ticket, { messages }) }));
};

// POST /users/app-issue/:id/reply — "No, reply": she answers in the same
// ticket and it reopens (status back to In review).
exports.replyTicket = async (req, res) => {
  const ticket = await ownTicket(req);
  if (!ticket) return res.json(ApiResponse("0", "Ticket not found", {}));
  const body = (req.body && req.body.message ? String(req.body.message) : "").trim().slice(0, 1000);
  const imageUrl = req.file ? publicUrl(req.file.filename) : null;
  if (!body && !imageUrl) return res.json(ApiResponse("0", "Please write a message.", {}));

  let user = null;
  try { user = await User.findByPk(ticket.userId); } catch (_) { /* ignore */ }

  const now = new Date();
  await SupportTicketMessage.create({
    ticketId: ticket.id,
    sender: "user",
    senderId: ticket.userId,
    senderName: fullName(user),
    body,
    imageUrl,
  });
  ticket.status = "in_review";
  ticket.resolvedAt = null;
  ticket.adminUnread = true;
  ticket.userUnread = false;
  ticket.lastActivityAt = now;
  if (ticket.feedback === "solved") ticket.feedback = null;
  // A reopened ticket gets a fresh 3 working day promise.
  ticket.dueAt = addWorkingDays(now, 3);
  await ticket.save();

  sendToCrm("support_issue_reply", {
    ticket_id: ticket.id,
    app_user_id: String(ticket.userId),
    message: body,
    image_url: imageUrl,
    status: ticket.status,
    external_event_id: `ticket_${ticket.id}_msg_${Date.now()}`,
  });

  const messages = await SupportTicketMessage.findAll({
    where: { ticketId: ticket.id },
    order: [["id", "ASC"]],
  });
  return res.json(ApiResponse("1", "Reply sent", { ticket: ticketJson(ticket, { messages }) }));
};

// POST /users/app-issue/:id/feedback  { solved: true|false }
exports.feedback = async (req, res) => {
  const ticket = await ownTicket(req);
  if (!ticket) return res.json(ApiResponse("0", "Ticket not found", {}));
  const solved = req.body && (req.body.solved === true || req.body.solved === "true");
  ticket.feedback = solved ? "solved" : "not_solved";
  if (solved) {
    ticket.status = "resolved";
    ticket.resolvedAt = ticket.resolvedAt || new Date();
  }
  await ticket.save();
  sendToCrm("support_issue_feedback", {
    ticket_id: ticket.id,
    app_user_id: String(ticket.userId),
    solved,
    external_event_id: `ticket_${ticket.id}_fb_${Date.now()}`,
  });
  return res.json(ApiResponse("1", "Thanks for letting us know", { ticket: ticketJson(ticket) }));
};
