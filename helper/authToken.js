// Login tokens (Oct 2026 security pass).
//
//   issueToken(user, { client })  app login  -> 30-day token  (c: "a")
//                                 portal     -> 12-hour token (c: "p")
//                                 web        -> 7-day token   (c: "w")
//                                 (member web app, Oct 2026: a browser is
//                                 shared more often than a phone, so shorter)
//   verifyAccess(token)           -> { payload, user }  or throws AuthError
//   renew(req, res, payload)      sliding renewal: sends a fresh token in the
//                                 `x-new-token` response header
//                                   app / legacy token older than 1 day
//                                   portal token older than 1 hour
//   revoke(userId)                tokenVersion + 1 -> every token she has
//                                 (all phones, portal) stops working
//
// Old tokens (signed before this change) have no `exp`: they keep working
// until LEGACY_TOKEN_UNTIL (default 2026-12-31, end of that day) so old app
// versions are not logged out at once; they are renewed to 30-day tokens.
// Legacy tokens count as tokenVersion 0, so a logout / password change
// also ends them.
const jwt = require("jsonwebtoken");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const APP_TTL = "30d";
const PORTAL_TTL = "12h";
const WEB_TTL = "7d";
const CACHE_MS = 45 * 1000;
const USER_ATTRS = ["id", "email", "userType", "status", "tokenVersion"];

const models = () => require("../models");
const cache = new Map(); // userId -> { user, at }

class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code; // NO_TOKEN | INVALID | EXPIRED | LEGACY_EXPIRED | REVOKED | NO_USER
  }
}

const secret = () => process.env.JWT_ACCESS_SECRET;
const isPortalClient = (client) => client === "portal" || client === "p";
const isWebClient = (client) => client === "web" || client === "w";

function issueToken(user, { client } = {}) {
  const portal = isPortalClient(client);
  const web = !portal && isWebClient(client);
  return jwt.sign(
    { id: user.id, email: user.email, tv: Number(user.tokenVersion) || 0, c: portal ? "p" : web ? "w" : "a" },
    secret(),
    { expiresIn: portal ? PORTAL_TTL : web ? WEB_TTL : APP_TTL }
  );
}

/** Last moment a legacy (no-exp) token is accepted, in ms. */
function legacyUntilMs() {
  const raw = String(process.env.LEGACY_TOKEN_UNTIL || "2026-12-31").trim();
  let t = Date.parse(raw);
  if (isNaN(t)) t = Date.parse("2026-12-31");
  // A plain date ("2026-12-31") means "until the end of that day".
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) || isNaN(Date.parse(raw))) t += DAY;
  return t;
}

async function loadUser(id) {
  const hit = cache.get(String(id));
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const { User } = models();
  let user;
  try {
    user = await User.findOne({ where: { id }, attributes: USER_ATTRS, raw: true });
  } catch (e) {
    // tokenVersion column missing (migration not run yet): don't lock everyone out.
    if (!/tokenVersion/i.test(String(e.message))) throw e;
    user = await User.findOne({ where: { id }, attributes: USER_ATTRS.filter((a) => a !== "tokenVersion"), raw: true });
  }
  if (user) cache.set(String(id), { user, at: Date.now() });
  else cache.delete(String(id));
  if (cache.size > 20000) {
    const cutoff = Date.now() - CACHE_MS;
    for (const [k, v] of cache) if (v.at < cutoff) cache.delete(k);
  }
  return user || null;
}

function invalidate(userId) {
  if (userId != null) cache.delete(String(userId));
}

async function verifyAccess(token) {
  if (!token) throw new AuthError("NO_TOKEN");
  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch (e) {
    throw new AuthError(e && e.name === "TokenExpiredError" ? "EXPIRED" : "INVALID", e && e.message);
  }
  if (!payload || payload.id == null) throw new AuthError("INVALID");
  if (payload.exp == null && Date.now() > legacyUntilMs()) throw new AuthError("LEGACY_EXPIRED");
  const user = await loadUser(payload.id);
  if (!user) throw new AuthError("NO_USER");
  const tv = payload.tv == null ? 0 : Number(payload.tv);
  if ((Number(user.tokenVersion) || 0) !== tv) throw new AuthError("REVOKED");
  return { payload, user };
}

/** Which client a verified token belongs to: "portal" | "web" | "app". */
const clientOf = (payload) => (payload && payload.c === "p" ? "portal" : payload && payload.c === "w" ? "web" : "app");

/** Sliding renewal: sets x-new-token when the token is old enough. */
function renew(res, payload, user) {
  try {
    if (!res || typeof res.setHeader !== "function" || res.headersSent) return null;
    if (res.locals && res.locals.__tokenRenewed) return null;
    const portal = payload.c === "p";
    const ageMs = payload.iat ? Date.now() - payload.iat * 1000 : Infinity;
    const due = payload.exp == null || ageMs > (portal ? HOUR : DAY);
    if (!due) return null;
    const fresh = issueToken({ id: user.id, email: user.email || payload.email, tokenVersion: user.tokenVersion }, { client: clientOf(payload) });
    setNewToken(res, fresh);
    return fresh;
  } catch (e) {
    console.warn("[authToken] renew:", e.message);
    return null;
  }
}

function setNewToken(res, token) {
  if (!res || res.headersSent) return;
  res.setHeader("x-new-token", token);
  const prev = String(res.getHeader("Access-Control-Expose-Headers") || "");
  if (!/x-new-token/i.test(prev)) {
    res.setHeader("Access-Control-Expose-Headers", prev ? `${prev}, x-new-token` : "x-new-token");
  }
  if (res.locals) res.locals.__tokenRenewed = true;
}

/** Logout everywhere / password changed: every old token stops working. */
async function revoke(userId) {
  if (userId == null) return null;
  const { User } = models();
  await User.increment("tokenVersion", { by: 1, where: { id: userId } });
  invalidate(userId);
  const u = await User.findOne({ where: { id: userId }, attributes: ["id", "email", "tokenVersion"], raw: true });
  return u;
}

module.exports = {
  issueToken,
  verifyAccess,
  renew,
  setNewToken,
  revoke,
  invalidate,
  clientOf,
  legacyUntilMs,
  AuthError,
  _cache: cache,
};
