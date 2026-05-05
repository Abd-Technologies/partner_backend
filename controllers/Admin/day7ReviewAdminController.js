const { Op } = require("sequelize");
const ApiResponse = require("../../helper/ApiResponse");
const { Day7Review, User, UserPlan, Plan } = require("../../models");

// GET /admin/day7-reviews?flagged=true|false&limit=&offset=
// Lists Day7Reviews with the user + plan joined. Admin dashboard's
// flagged-queue view passes flagged=true; the dietitian dashboard view
// for a single user filters with userId in a future enhancement.
exports.listReviews = async (req, res) => {
  try {
    const flaggedParam = req.query.flagged;
    const where = {};
    if (flaggedParam === "true") where.flagged = true;
    if (flaggedParam === "false") where.flagged = false;

    if (req.query.userId !== undefined) {
      const uid = parseInt(req.query.userId, 10);
      if (Number.isInteger(uid) && uid > 0) where.userId = uid;
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
