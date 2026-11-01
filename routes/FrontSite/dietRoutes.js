const express = require('express');
const dietController = require('../../controllers/FrontSite/dietController');
const { validateToken } = require('../../middlewares/AuthorizationMW');

const multer = require("multer");
const path = require("path");
const router = express.Router();

const uploadimage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, `./public/calorieUploads`);
  },
  filename: (req, file, cb) => {
    cb(
      null,
      file.fieldname +
        "-" +
        Math.floor(Math.random() * 1000000000) +
        "-" +
        path.extname(file.originalname)
    );
  },
});
const upload = multer({
  storage: uploadimage,
  // Oct 2026 security audit: images only, 15 MB (helper/uploadRules.js).
  fileFilter: require('../../helper/uploadRules').filter(),
  limits: require('../../helper/uploadRules').limits,
});


// Read-only endpoints — public list of weekday days and per-dietitian
// slot read are unauthenticated so the client can render booking UIs
// without forcing login first.
router.get('/', validateToken, dietController.getAllDietTimes);
router.post('/', validateToken, dietController.getAllSlotsOfDay);

// Writes / reads scoped to the caller. validateToken populates req.user;
// each handler enforces that req.user.id matches the resource being
// touched, so a logged-in dietitian cannot edit another dietitian's
// slots and a logged-in user cannot bump another user's calorie counter.
router.post('/addOrUpdateDaySlot', validateToken, dietController.addOrUpdateDaySlot);
// Nov 2026: one Meet link for all her slots (and upcoming bookings).
router.post('/setLinkForAllSlots', validateToken, dietController.setLinkForAllSlots);
router.get('/getClients/:id', validateToken, dietController.getAllClients);
router.post('/upload', validateToken, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `${req.protocol}://${req.get('host')}/public/calorieUploads/${req.file.filename}`;
  res.json({ url: fileUrl });
});
router.post('/checkNutrition/:id', validateToken, dietController.checkNutrition);



module.exports = router;