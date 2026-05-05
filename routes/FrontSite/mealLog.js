const express = require("express");
const router = express.Router();

const { validateToken } = require("../../middlewares/AuthorizationMW");
const asyncMiddleware = require("../../middlewares/async");
const ctrl = require("../../controllers/FrontSite/mealLogController");

// POST /users/meal-logs       — upsert today/recent log
// GET  /users/meal-logs       — list within a date range (default 30d)
router.post("/", validateToken, asyncMiddleware(ctrl.upsertMealLog));
router.get("/", validateToken, asyncMiddleware(ctrl.listMealLogs));

module.exports = router;
