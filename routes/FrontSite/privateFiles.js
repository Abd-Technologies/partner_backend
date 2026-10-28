// GET /files/<path under ./public>   (Oct 2026 — protected private files)
//
// Auth: `accessToken` header (same JWT as every other route) OR ?t=<token>
// for image widgets that can't send headers (Flutter web Image.network,
// <img>, NetworkImage). Rules live in helper/privateFiles.js:
//   slips          -> owner, Admin, Customer_Support_Representative
//   issue images   -> owner, Admin, Customer_Support_Representative
//   progress/meal  -> owner, Admin, her own dietitian
//   owner unknown  -> Admin only
//   public files   -> any logged-in user
// 401 no/invalid token, 404 missing file or bad path, 403 not allowed.
const express = require("express");
const pf = require("../../helper/privateFiles");

const router = express.Router();

const send = (res, code, message) => res.status(code).json({ status: "0", message, data: {} });

router.get("/*", async (req, res) => {
  try {
    const payload = await pf.verifyToken(pf.readToken(req));
    if (!payload || payload.id == null) return send(res, 401, "Please log in again to view this file.");

    const rel = pf.toRelative(req.path);
    if (!rel) return send(res, 404, "File not found.");
    const abs = pf.absPath(rel);
    let st;
    try { st = await pf._fs.promises.stat(abs); } catch (_) { st = null; }
    if (!st || !st.isFile()) return send(res, 404, "File not found.");

    const { User } = require("../../models");
    const user = await User.findOne({ where: { id: payload.id }, attributes: ["id", "userType", "status"], raw: true });
    if (!user) return send(res, 401, "Please log in again to view this file.");

    const info = await pf.classify(rel);
    if (!(await pf.canView(user, info))) {
      return send(res, 403, "You don't have access to this file.");
    }

    res.set("Cache-Control", "private, max-age=3600");
    res.set("X-Content-Type-Options", "nosniff");
    return res.sendFile(abs, { dotfiles: "deny" }, (err) => {
      if (err && !res.headersSent) send(res, 404, "File not found.");
    });
  } catch (e) {
    console.error("[privateFiles]", e.message);
    if (!res.headersSent) return send(res, 500, "Couldn't load the file. Please try again.");
  }
});

module.exports = router;
