const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/FrontSite/appNotifyController");

// Server-to-server endpoints (CRM → app backend). Auth is via the shared
// x-internal-secret header inside each controller, NOT a user token.

// POST /internal/app-notify — push a message to a user's device (e.g. issue resolved)
router.post("/app-notify", ctrl.appNotify);

module.exports = router;
