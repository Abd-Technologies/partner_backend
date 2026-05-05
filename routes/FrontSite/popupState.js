const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/popupStateController");

// POST /users/popup/:variable/dismiss
// POST /users/popup/:variable/complete
router.post(
  "/:variable/dismiss",
  validateToken,
  asyncMiddleware(ctrl.dismissPopup)
);
router.post(
  "/:variable/complete",
  validateToken,
  asyncMiddleware(ctrl.completePopup)
);

module.exports = router;
