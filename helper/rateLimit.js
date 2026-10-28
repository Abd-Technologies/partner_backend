// In-memory rate limiting (Oct 2026 security pass). No extra packages.
// Sliding window per key: we keep the times of recent hits and refuse once
// `limit` hits happened inside the last `windowMs`.
// One server process = one memory. If the backend ever runs several
// processes, each one counts on its own (limits get looser, never stricter).
//
// RATE_LIMIT_OFF=true switches every limiter off (emergency kill switch).
const ApiResponse = require("./ApiResponse");

const MIN = 60 * 1000;
const MSG = "Too many tries. Please wait a few minutes and try again.";
const buckets = new Map(); // key -> number[] (hit times, oldest first)

const off = () => String(process.env.RATE_LIMIT_OFF || "").trim().toLowerCase() === "true";

/** Record a hit. Returns { ok, count, retryAfterMs }. Refused hits are not recorded. */
function hit(key, limit, windowMs, now = Date.now()) {
  let arr = buckets.get(key);
  if (!arr) {
    arr = [];
    buckets.set(key, arr);
  }
  const cutoff = now - windowMs;
  while (arr.length && arr[0] <= cutoff) arr.shift();
  if (arr.length >= limit) {
    return { ok: false, count: arr.length, retryAfterMs: Math.max(0, arr[0] + windowMs - now) };
  }
  arr.push(now);
  return { ok: true, count: arr.length, retryAfterMs: 0 };
}

/** Only checks (no hit recorded). */
function wouldBlock(key, limit, windowMs, now = Date.now()) {
  const arr = buckets.get(key) || [];
  return arr.filter((t) => t > now - windowMs).length >= limit;
}

function reset(key) {
  if (key == null) buckets.clear();
  else buckets.delete(key);
}

// Drop old keys every 5 minutes so memory stays small.
const MAX_WINDOW = 60 * MIN;
const sweeper = setInterval(() => {
  const cutoff = Date.now() - MAX_WINDOW;
  for (const [k, arr] of buckets) {
    if (!arr.length || arr[arr.length - 1] <= cutoff) buckets.delete(k);
  }
}, 5 * MIN);
if (sweeper.unref) sweeper.unref();

const ipOf = (req) => String(req.ip || (req.connection && req.connection.remoteAddress) || "unknown");
const emailOf = (req) => String((req.body && req.body.email) || "").trim().toLowerCase();

function refuse(res, retryAfterMs, message = MSG) {
  if (retryAfterMs) res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  return res.status(429).json(ApiResponse("0", message, {}));
}

/**
 * limiter(name, rules, { skip })
 *   rules: [{ limit, windowMs, key: (req) => string | null }]
 * Every rule must pass; a rule whose key() is null/"" is ignored.
 */
function limiter(name, rules, opts = {}) {
  return (req, res, next) => {
    try {
      if (off() || (opts.skip && opts.skip(req))) return next();
      // Check all rules first so a refused request isn't counted twice.
      const keyed = rules
        .map((r) => ({ ...r, k: r.key(req) }))
        .filter((r) => r.k);
      for (const r of keyed) {
        const full = `${name}:${r.limit}/${r.windowMs}:${r.k}`;
        if (wouldBlock(full, r.limit, r.windowMs)) {
          const arr = buckets.get(full) || [];
          const retry = arr.length ? arr[0] + r.windowMs - Date.now() : r.windowMs;
          return refuse(res, retry);
        }
      }
      for (const r of keyed) hit(`${name}:${r.limit}/${r.windowMs}:${r.k}`, r.limit, r.windowMs);
      return next();
    } catch (e) {
      console.error("[rateLimit]", e.message);
      return next(); // never block because of a limiter bug
    }
  };
}

// Ready-made limiters for the auth routes.
const loginLimit = limiter("login", [
  { limit: 10, windowMs: 15 * MIN, key: (req) => (emailOf(req) ? `${ipOf(req)}|${emailOf(req)}` : null) },
  { limit: 50, windowMs: 15 * MIN, key: ipOf },
]);
const otpLimit = limiter("otp", [{ limit: 10, windowMs: 15 * MIN, key: ipOf }]);
// Public sign-up only: staff adding a user (signupGuard sets req.user) is not limited.
const signupLimit = limiter("signup", [{ limit: 20, windowMs: 60 * MIN, key: ipOf }], {
  skip: (req) => !!(req.user && req.user.userType),
});

module.exports = { hit, wouldBlock, reset, limiter, loginLimit, otpLimit, signupLimit, refuse, MSG, ipOf, _buckets: buckets };
