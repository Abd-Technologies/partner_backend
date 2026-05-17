const express = require('express');
const router = express.Router();

const { validateAdmin } = require('../../middlewares/ValidateAdmin');
const asyncMiddleware = require('../../middlewares/async');
const ctrl = require('../../controllers/Admin/dietPlanAdminController');

// Mounted at /admin/diet-plan in app.js.
//
// Phase C — generation + activation:
//   POST  /admin/diet-plan/generate           — generate + save a draft
//   POST  /admin/diet-plan/:id/activate       — flip a draft to active
//   GET   /admin/diet-plan/:id                — fetch any plan
//
// Phase D — list / edit / cancel:
//   GET   /admin/diet-plan/drafts             — caller dietitian's drafts
//   GET   /admin/diet-plan/user/:userId/list  — all plans for a user
//   PATCH /admin/diet-plan/meal/:mealId       — edit one meal in place
//   POST  /admin/diet-plan/:id/cancel         — cancel a plan
//
// `/drafts` and `/user/:userId/list` are deliberately registered ahead
// of `/:id` so Express doesn't accidentally route the literal segment
// to the param handler.

router.get('/drafts', validateAdmin, asyncMiddleware(ctrl.listMyDraftsHandler));
router.get(
  '/user/:userId/list',
  validateAdmin,
  asyncMiddleware(ctrl.listPlansForUserHandler)
);
router.patch(
  '/meal/:mealId',
  validateAdmin,
  asyncMiddleware(ctrl.updateMealHandler)
);

router.post('/generate', validateAdmin, asyncMiddleware(ctrl.generateDietPlanDraft));
router.post('/:id/activate', validateAdmin, asyncMiddleware(ctrl.activateDietPlanHandler));
router.post('/:id/cancel', validateAdmin, asyncMiddleware(ctrl.cancelPlanHandler));
router.get('/:id', validateAdmin, asyncMiddleware(ctrl.getDietPlanByIdAdmin));

module.exports = router;
