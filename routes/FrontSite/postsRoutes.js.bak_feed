const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const postsController = require('../../controllers/FrontSite/postsController');
const ApiResponse = require('../../helper/ApiResponse');
const { validateToken } = require('../../middlewares/AuthorizationMW');

const router = express.Router();

// === Multer setup for image upload ===
const UPLOAD_DIR = './public/posts';
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const rawExt = path.extname(file.originalname || '').toLowerCase();
    const ext = ALLOWED_EXT.has(rawExt) ? rawExt : '.jpg';
    const random = Math.random().toString(36).slice(2, 10);
    cb(null, `image-${Date.now()}-${random}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new Error('Only image files (jpg, png, webp, gif) are allowed'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter,
});

// Wrap upload.single so multer errors return a clean JSON response
// instead of crashing the request or leaking stack traces.
const uploadImage = (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (!err) return next();
    const message =
      err instanceof multer.MulterError
        ? err.message
        : err.message || 'Image upload failed';
    return res.status(400).json(ApiResponse('0', message, {}));
  });
};

// === Routes ===
// All mutating routes require a valid accessToken. The current user's id is
// taken from req.user.id (set by validateToken) — clients no longer pass
// userId in the body. Owner / admin checks live inside the controller.

// Get all posts (approved / unapproved). Optional ?limit & ?offset.
// Pending feed (approved=false) is admin-only — enforced in the controller.
router.get('/:approved', validateToken, postsController.getAllPosts);

// Create new post (with optional image)
router.post('/', validateToken, uploadImage, postsController.createPost);

// Send a reply (WhatsApp-style chat message)
router.post('/reply', validateToken, postsController.createReply);

// Like or unlike a post
router.post('/like', validateToken, postsController.toggleLike);

// Delete a post (owner or admin)
router.delete('/:id', validateToken, postsController.deletePost);

// Approve a post (admin only — enforced in controller)
router.put('/approve/:id', validateToken, postsController.approvePost);

module.exports = router;
