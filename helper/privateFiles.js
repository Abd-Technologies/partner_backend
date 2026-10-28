// Protected private files (Oct 2026).
//
// Everything users upload lands under ./public, which express.static serves
// to anyone who knows (or guesses) the URL. Some of those uploads are
// private: payment slips, before/after progress photos, support-ticket
// screenshots and calorie/meal photos. This helper decides, for a path
// under ./public, whether the file is private, who owns it, and whether a
// given logged-in person may see it.
//
// Used by:
//   routes/FrontSite/privateFiles.js  -> GET /files/<path under public>
//   app.js (guard before express.static) -> blocks /public/<private> when
//                                           PRIVATE_FILES_PUBLIC=false
//
// Folders:
//   public/payment_slips/*   PRIVATE  magic-link slips      (PlanImage.image)
//   public/issueUploads/*    PRIVATE  support screenshots   (SupportTicket / SupportTicketMessage.imageUrl)
//   public/calorieUploads/*  PRIVATE  meal photos (not linked to any row -> Admin only)
//   public/images/before-*,
//   public/images/after-*    PRIVATE  progress photos       (ProgressImage.before/after)
//   public/images/image-*    MIXED    the shared admin multer folder: in-app
//                                     slips (PlanImage.image) are private,
//                                     plan/package images, testimonials,
//                                     tips and profile photos stay public
//   public/posts/*           PUBLIC   community feed (shared by design)
//   anything else            PUBLIC

const path = require("path");
const fs = require("fs");
const { verifyAccess } = require("./authToken");
const { Op } = require("sequelize");

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

// Lazily required so the file can be loaded (and unit-tested with mocked
// models) without opening a DB connection at require time.
const models = () => require("../models");

const norm = (s) => String(s || "").trim().toLowerCase();
const ROLE = {
  admin: "admin",
  csr: "customer_support_representative",
  dietitian: ["dietition", "dietitian"],
};
const isAdmin = (t) => norm(t) === ROLE.admin;
const isCsr = (t) => norm(t) === ROLE.csr;
const isDietitian = (t) => ROLE.dietitian.includes(norm(t));

// "/images/x.jpg", "public/images/x.jpg", "C:/srv/app/public/images/x.jpg",
// "https://host/public/images/x.jpg" -> "images/x.jpg". Returns null for
// anything that tries to leave ./public (.., NUL, absolute escapes, dotfiles).
function toRelative(input) {
  if (input == null) return null;
  let p = String(input);
  try { p = decodeURIComponent(p); } catch (_) { return null; }
  if (p.includes("\0")) return null;
  p = p.replace(/\\/g, "/").split("?")[0].split("#")[0];
  const i = p.toLowerCase().lastIndexOf("/public/");
  if (/^https?:\/\//i.test(p)) {
    if (i < 0) return null;
    p = p.slice(i + 8);
  } else if (i >= 0) {
    p = p.slice(i + 8);
  } else if (p.toLowerCase().startsWith("public/")) {
    p = p.slice(7);
  }
  p = p.replace(/^\/+/, "");
  if (!p) return null;
  const parts = p.split("/");
  if (parts.some((s) => s === ".." || s === "." || s === "" || s.startsWith("."))) return null;
  const abs = path.resolve(PUBLIC_DIR, p);
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) return null;
  return parts.join("/");
}

const absPath = (rel) => path.resolve(PUBLIC_DIR, rel);

// LIKE pattern "%<rel>" with MySQL wildcards escaped.
const likeSuffix = (rel) => "%" + rel.replace(/[\\%_]/g, (c) => "\\" + c);

// Fast, DB-free classification by folder/file name.
//   "private" | "public" | "maybe" (public/images/image-*: needs a DB check)
function folderKind(rel) {
  // Lower-cased: on a case-insensitive disk (Windows/macOS) /public/Payment_Slips
  // would otherwise slip past this check.
  const [folder, ...rest] = rel.toLowerCase().split("/");
  const file = rest.join("/");
  switch (folder) {
    case "payment_slips":
    case "issueuploads":
    case "calorieuploads":
      return "private";
    case "images":
      if (/^(before|after)-/i.test(file)) return "private";
      return "maybe";
    default:
      return "public";
  }
}

// Full classification with owner lookup.
// -> { private: bool, kind: 'slip'|'progress'|'issue'|'meal'|null, ownerId: number|null }
async function classify(rel) {
  const { PlanImage, ProgressImage, SupportTicket, SupportTicketMessage } = models();
  const folder = rel.split("/")[0].toLowerCase();
  const like = likeSuffix(rel);

  const slipOwner = async () => {
    const row = await PlanImage.findOne({ where: { image: { [Op.like]: like } }, attributes: ["id", "UserId"], raw: true });
    return row ? { found: true, ownerId: row.UserId != null ? Number(row.UserId) : null } : { found: false };
  };
  const progressOwner = async () => {
    const row = await ProgressImage.findOne({
      where: { [Op.or]: [{ before: { [Op.like]: like } }, { after: { [Op.like]: like } }] },
      attributes: ["id", "UserId"],
      raw: true,
    });
    return row ? { found: true, ownerId: row.UserId != null ? Number(row.UserId) : null } : { found: false };
  };

  if (folder === "payment_slips") {
    const s = await slipOwner();
    return { private: true, kind: "slip", ownerId: s.found ? s.ownerId : null };
  }
  if (folder === "issueuploads") {
    let ownerId = null;
    const t = await SupportTicket.findOne({ where: { imageUrl: { [Op.like]: like } }, attributes: ["id", "userId"], raw: true });
    if (t) ownerId = Number(t.userId);
    else {
      const m = await SupportTicketMessage.findOne({ where: { imageUrl: { [Op.like]: like } }, attributes: ["id", "ticketId"], raw: true });
      if (m) {
        const tk = await SupportTicket.findOne({ where: { id: m.ticketId }, attributes: ["id", "userId"], raw: true });
        if (tk) ownerId = Number(tk.userId);
      }
    }
    return { private: true, kind: "issue", ownerId };
  }
  if (folder === "calorieuploads") {
    // Upload endpoint only returns a URL; no row records who sent it.
    return { private: true, kind: "meal", ownerId: null };
  }
  if (folder === "images") {
    const file = rel.slice(folder.length + 1);
    if (/^(before|after)-/i.test(file)) {
      const p = await progressOwner();
      return { private: true, kind: "progress", ownerId: p.found ? p.ownerId : null };
    }
    const s = await slipOwner();
    if (s.found) return { private: true, kind: "slip", ownerId: s.ownerId };
    const p = await progressOwner();
    if (p.found) return { private: true, kind: "progress", ownerId: p.ownerId };
    return { private: false, kind: null, ownerId: null };
  }
  return { private: false, kind: null, ownerId: null };
}

// Small cache so the /public guard doesn't hit the DB for every plan image.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();
async function classifyCached(rel) {
  const hit = cache.get(rel);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await classify(rel);
  if (cache.size > 5000) cache.clear();
  cache.set(rel, { v, exp: Date.now() + CACHE_TTL_MS });
  return v;
}

// Who may see a private file.
//   slip     -> owner, Admin, Customer_Support_Representative
//   issue    -> owner, Admin, Customer_Support_Representative
//   progress -> owner, Admin, the client's own dietitian
//   meal     -> owner, Admin, the client's own dietitian
//   owner unknown -> Admin only
async function canView(user, info) {
  if (!user) return false;
  if (!info.private) return true;
  const type = user.userType;
  if (isAdmin(type)) return true;
  if (info.ownerId == null) return false;
  if (Number(user.id) === Number(info.ownerId)) return true;
  if ((info.kind === "slip" || info.kind === "issue") && isCsr(type)) return true;
  if ((info.kind === "progress" || info.kind === "meal") && isDietitian(type)) {
    const { getAssignedClientIds } = require("./dietitianScope");
    const ids = await getAssignedClientIds(user.id);
    return ids.has(Number(info.ownerId));
  }
  return false;
}

// Same verify as middlewares/AuthorizationMW.js (accessToken header), plus
// ?t=<token> for <img>/Image.network callers that can't send headers.
function readToken(req) {
  return req.header("accessToken") || (req.query && typeof req.query.t === "string" ? req.query.t : "") || "";
}
// Async since Oct 2026 (helper/authToken.js: expiry + logout revocation).
async function verifyToken(token) {
  if (!token) return null;
  try {
    const { payload } = await verifyAccess(token);
    return payload || null;
  } catch (_) {
    return null;
  }
}

// PRIVATE_FILES_PUBLIC: "true" (default) keeps old behaviour so old app
// versions that load /public/<slip> directly keep working. "false" makes
// /public/<private file> return 403; only GET /files/... serves them.
function privateFilesPublic() {
  return String(process.env.PRIVATE_FILES_PUBLIC ?? "true").trim().toLowerCase() !== "false";
}

// Middleware for app.use("/public", publicGuard, express.static(...)).
function publicGuard(req, res, next) {
  if (privateFilesPublic()) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const rel = toRelative(req.path);
  if (!rel) return next(); // express.static rejects/404s these itself
  const fk = folderKind(rel);
  if (fk === "public") return next();
  const deny = () =>
    res.status(403).json({ status: "0", message: "This file is private. Please update the app to view it.", data: {} });
  if (fk === "private") return deny();
  classifyCached(rel)
    .then((info) => (info.private ? deny() : next()))
    .catch(() => deny()); // fail closed
}

module.exports = {
  PUBLIC_DIR,
  toRelative,
  absPath,
  folderKind,
  classify,
  classifyCached,
  canView,
  readToken,
  verifyToken,
  privateFilesPublic,
  publicGuard,
  _cache: cache,
  _fs: fs,
};
