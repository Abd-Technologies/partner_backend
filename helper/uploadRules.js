// Upload safety (Oct 2026 security audit).
// Files land in ./public and are served by express.static, and the saved
// name keeps the original extension — so an uploaded .html / .svg / .js
// would be served as a web page from our domain (stored XSS), and with no
// size limit anyone logged in could fill the disk.
// Only real images (and PDF where allowed), max 15 MB.
const path = require("path");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".gif"]);
const MAX_BYTES = 15 * 1024 * 1024;

function filter({ allowPdf = false } = {}) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = String(file.mimetype || "").toLowerCase();
    const isImage = IMAGE_EXT.has(ext) && (mime.startsWith("image/") || mime === "application/octet-stream");
    const isPdf = allowPdf && ext === ".pdf" && (mime === "application/pdf" || mime === "application/octet-stream");
    if (isImage || isPdf) return cb(null, true);
    const err = new Error(allowPdf ? "Only images or PDF files can be uploaded." : "Only images can be uploaded.");
    err.code = "UPLOAD_TYPE";
    return cb(err);
  };
}

const limits = { fileSize: MAX_BYTES, files: 5 };

module.exports = { filter, limits, MAX_BYTES };
