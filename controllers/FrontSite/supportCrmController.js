const ApiResponse = require("../../helper/ApiResponse");
const { SupportTicket } = require("../../models");
const { STATUSES, applyStaffReply } = require("../../helper/supportTickets");

/**
 * supportTicketUpdate — POST /internal/support-ticket-update
 *
 * Server to server, called by the CRM when an agent replies to or resolves a
 * support ticket. Same auth as /internal/app-notify: the shared
 * APP_WEBHOOK_SECRET in the `x-internal-secret` header.
 *
 * Body:
 *   ticket_id          — the id we sent in the support_issue webhook
 *                        (or external_event_id "ticket_<id>")
 *   message            — optional reply text shown to the user
 *   status             — optional: received | in_review | resolved
 *   agent_name         — optional, shown as "<name>, FitHer Support"
 *
 * The user gets the reply in the app under Your reports plus a push.
 */
exports.supportTicketUpdate = async (req, res) => {
  try {
    const secret = process.env.APP_WEBHOOK_SECRET;
    if (!secret || req.headers["x-internal-secret"] !== secret) {
      return res.status(403).json(ApiResponse("0", "Forbidden", {}));
    }

    const b = req.body || {};
    let id = parseInt(b.ticket_id, 10);
    if (!id && typeof b.external_event_id === "string") {
      const m = b.external_event_id.match(/^ticket_(\d+)/);
      if (m) id = parseInt(m[1], 10);
    }
    if (!id) return res.status(400).json(ApiResponse("0", "ticket_id is required", {}));

    const ticket = await SupportTicket.findByPk(id);
    if (!ticket) return res.status(404).json(ApiResponse("0", "Ticket not found", {}));

    const status = typeof b.status === "string" ? b.status.toLowerCase() : null;
    const agent = typeof b.agent_name === "string" && b.agent_name.trim()
      ? `${b.agent_name.trim().split(" ")[0]}, FitHer Support`
      : "FitHer Support";

    const out = await applyStaffReply(ticket, {
      body: b.message,
      status: STATUSES.includes(status) ? status : null,
      sender: "crm",
      senderName: agent,
    });
    if (!out.ok) return res.status(400).json(ApiResponse("0", "message or status is required", {}));

    return res.json(ApiResponse("1", "Ticket updated", { ticket_id: ticket.id, status: ticket.status }));
  } catch (err) {
    console.error("[supportCrm] update failed:", err.message);
    return res.status(500).json(ApiResponse("0", "Failed to update ticket", {}));
  }
};
