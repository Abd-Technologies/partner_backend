const express = require("express");
const router = express.Router();

const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/Admin/preConsultationAdminController");

// All routes are staff-only (validateAdmin allows any non-User userType:
// Admin, Dietition, Trainer, Gynecologist, Psychiatrist).
router.get("/:userId", validateAdmin, asyncMiddleware(ctrl.getProfile));
router.patch("/:userId", validateAdmin, asyncMiddleware(ctrl.updateProfile));
router.post(
  "/:userId/comments",
  validateAdmin,
  asyncMiddleware(ctrl.addComment)
);

module.exports = router;
