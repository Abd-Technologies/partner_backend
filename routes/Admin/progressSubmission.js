const express = require("express");
const router = express.Router();

const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/progressSubmissionController");

// GET /admin/users/:userId/progress — dietitian dashboard view
router.get(
  "/:userId/progress",
  validateAdmin,
  require("../../helper/dietitianScope").ownClientOnly("userId"),
  asyncMiddleware(ctrl.listForUser)
);

module.exports = router;
