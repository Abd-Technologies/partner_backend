const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { EscalationTicket, User } = require("../../models");

// GET /admin/escalations?status=open&trigger=&limit=&offset=
exports.listTickets = async (req, res) => {
  try {
    const where = {};
    if (
      typeof req.query.status === "string" &&
      ["open", "acknowledged", "resolved"].includes(req.query.status)
    ) {
      where.status = req.query.status;
    }
    if (typeof req.query.trigger === "string") {
      where.trigger = req.query.trigger;
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const rows = await EscalationTicket.findAll({
      where,
      include: [
        {
          model: User,
          as: "client",
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: User,
          as: "dietitian",
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
      order: [
        ["status", "ASC"], // open first
        ["severity", "DESC"], // high before medium before low
        ["openedAt", "DESC"],
      ],
      limit,
      offset,
    });

    return res.json(
      ApiResponse("1", "Escalations fetched", {
        limit,
        offset,
        tickets: rows.map((r) => r.toJSON()),
      })
    );
  } catch (err) {
    console.error("[escalation/admin] listTickets:", err);
    return res.json(ApiResponse("0", "Failed to fetch escalations", {}));
  }
};

// POST /admin/escalations/:id/resolve
// Body: { resolutionNote?: string }
exports.resolveTicket = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.json(ApiResponse("0", "Invalid ticket id", {}));
    }
    const ticket = await EscalationTicket.findByPk(id);
    if (!ticket) return res.json(ApiResponse("0", "Ticket not found", {}));

    if (ticket.status === "resolved") {
      return res.json(
        ApiResponse("0", "Ticket already resolved", { ticket: ticket.toJSON() })
      );
    }

    const note =
      req.body && typeof req.body.resolutionNote === "string"
        ? req.body.resolutionNote.slice(0, 500)
        : null;

    await ticket.update({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: req.user && req.user.id,
      resolutionNote: note,
    });

    return res.json(
      ApiResponse("1", "Ticket resolved", { ticket: ticket.toJSON() })
    );
  } catch (err) {
    console.error("[escalation/admin] resolveTicket:", err);
    return res.json(ApiResponse("0", "Failed to resolve ticket", {}));
  }
};
