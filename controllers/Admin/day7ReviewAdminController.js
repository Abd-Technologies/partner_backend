const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { Day7Review, User, UserPlan, Plan } = require("../../models");
const {
  getAssignedClientIds,
  isUnscopedRole,
} = require("../../helper/dietitianScope");

// GET /admin/day7-reviews?flagged=true|false&includeResolved=true&limit=&offset=
// Lists Day7Reviews with the user + plan joined. Admin dashboard's
// flagged-queue view passes flagged=true; the dietitian dashboard view
// for a single user filters with userId in a future enhancement.
//
// flagged=true means "needs attention" by default, so it also excludes
// reviews whose flag has already been staff-acknowledged
// (flagResolvedAt set — see escalationAdminController.js::resolveTicket
// and the migration adding this column). Pass includeResolved=true to
// see the full flagged history including already-resolved ones.
exports.listReviews = async (req, res) => {
  try {
    const flaggedParam = req.query.flagged;
    const where = {};
    if (flaggedParam === "true") {
      where.flagged = true;
      if (req.query.includeResolved !== "true") {
        where.flagResolvedAt = null;
      }
    }
    if (flaggedParam === "false") where.flagged = false;

    if (req.query.userId !== undefined) {
      const uid = parseInt(req.query.userId, 10);
      if (Number.isInteger(uid) && uid > 0) where.userId = uid;
    }

    // Scope to the logged-in dietitian's own clients — Day7Review has no
    // dietitianId column of its own, so this resolves the same way
    // day7ReviewController.js::resolveDietitianId does but in reverse
    // (dietitian -> her client ids). Admin still sees everyone. Without
    // this, any non-User login could pull every client's reviews by
    // just calling this endpoint with no userId filter at all.
    if (!isUnscopedRole(req.user && req.user.userType)) {
      const assignedIds = await getAssignedClientIds(req.user && req.user.id);
      const wantsSpecificUser = where.userId !== undefined;
      const allowed = wantsSpecificUser
        ? assignedIds.has(where.userId)
        : assignedIds.size > 0;
      if (!allowed) {
        return res.json(
          ApiResponse("1", "Reviews fetched", {
            limit: 0,
            offset: 0,
            reviews: [],
          })
        );
      }
      if (!wantsSpecificUser) {
        // Never hand Sequelize an empty IN() — guarded above, but an
        // explicit array (not a Set) keeps the query shape obvious.
        where.userId = { [Op.in]: [...assignedIds] };
      }
    }

    const limit = Math.min(
      parseInt(req.query.limit, 10) || 50,
      200
    );
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const rows = await Day7Review.findAll({
      where,
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
        },
        {
          model: UserPlan,
          attributes: ["id", "buyingDate", "expireDate", "PlanId"],
          include: [
            {
              model: Plan,
              attributes: ["id", "title"],
            },
          ],
        },
      ],
      order: [
        ["flagged", "DESC"],
        ["createdAt", "DESC"],
      ],
      limit,
      offset,
    });

    return res.json(
      ApiResponse("1", "Reviews fetched", {
        limit,
        offset,
        reviews: rows.map((r) => r.toJSON()),
      })
    );
  } catch (err) {
    console.error("[day7Review/admin] listReviews:", err);
    return res.json(ApiResponse("0", "Failed to fetch reviews", {}));
  }
};
