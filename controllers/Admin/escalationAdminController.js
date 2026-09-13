const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { EscalationTicket, User, Day7Review } = require("../../models");
const { notifyClientFlagResolved } = require("../../helper/escalation");
const { isUnscopedRole } = require("../../helper/dietitianScope");

// GET /admin/escalations?status=open&trigger=&limit=&offset=
//
// Scoped to the logged-in staff member: only an Admin sees every
// dietitian's tickets. Everyone else (Dietition, Trainer, Gynecologist,
// Psychiatrist) only sees tickets addressed to them — before this,
// validateAdmin's blocklist-only check meant any non-User login could
// list every ticket for every dietitian.
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
    if (!isUnscopedRole(req.user && req.user.userType)) {
      where.dietitianId = req.user && req.user.id;
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

    // Same scoping as listTickets — a non-Admin can only resolve a
    // ticket addressed to her. Returned as "not found" rather than a
    // 403 so this doesn't confirm to a prober that a given ticket id
    // exists and just belongs to someone else.
    if (
      !isUnscopedRole(req.user && req.user.userType) &&
      ticket.dietitianId !== (req.user && req.user.id)
    ) {
      return res.json(ApiResponse("0", "Ticket not found", {}));
    }

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

    // Close the flagged-review loop. Day7Review.flagged is recomputed
    // from raw fields on every save (see the model's beforeSave hook),
    // so resolving the ticket can't just write `flagged: false` — the
    // next save would instantly re-derive it back to true. Instead we
    // stamp the separate flagResolvedAt/flagResolvedBy pair (added
    // alongside this change) that records staff acknowledgment without
    // touching the computed flag, then best-effort tell the client
    // someone looked at it. This never blocks the resolve response —
    // the ticket is already resolved above regardless of what happens
    // here.
    if (
      ticket.trigger === "REVIEW_FLAG" &&
      ticket.payload &&
      ticket.payload.reviewId
    ) {
      try {
        const review = await Day7Review.findByPk(ticket.payload.reviewId);
        if (review && review.flagged && !review.flagResolvedAt) {
          await review.update({
            flagResolvedAt: new Date(),
            flagResolvedBy: req.user && req.user.id,
          });
          await notifyClientFlagResolved(review.userId);
        }
      } catch (e) {
        console.error(
          "[escalation/admin] flagged-review resolve step failed:",
          e
        );
      }
    }

    return res.json(
      ApiResponse("1", "Ticket resolved", { ticket: ticket.toJSON() })
    );
  } catch (err) {
    console.error("[escalation/admin] resolveTicket:", err);
    return res.json(ApiResponse("0", "Failed to resolve ticket", {}));
  }
};
