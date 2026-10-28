const ApiResponse = require("../helper/ApiResponse");
const { verifyAccess, renew } = require("../helper/authToken");
const { isStaff } = require("../helper/roles");

const validateAdmin = async (req, res, next) => {
  const accessToken = req.header("accessToken");
  if (!accessToken) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  // Bug A fix: verify() throws JsonWebTokenError / TokenExpiredError on invalid
  // or expired tokens. Without try/catch this was an unhandled async throw in
  // Express 4 middleware, crashing the server process instead of returning JSON.
  // Oct 2026: helper/authToken.js (expiry, logout revocation, renewal).
  let auth;
  try {
    auth = await verifyAccess(accessToken);
  } catch (err) {
    // Bug B fix kept: deleted account / stale token -> "User not found!".
    if (err && err.code === "NO_USER") return res.json(ApiResponse("0", "User not found!", {}));
    if (err && err.code) return res.json(ApiResponse("0", "Invalid accessToken!", {}));
    return next(err);
  }

  req.user = auth.payload;
  const user = auth.user;
  renew(res, auth.payload, auth.user);

  // Normalised check: a client stored as "user" / "User " is NOT staff,
  // and an account with no type at all is not staff either.
  if (isStaff(user)) {
    // Enrich req.user (until now just the JWT payload — {email, id}) with
    // the userType we already fetched above, at no extra query cost.
    // Downstream Admin-side controllers use this to scope data to the
    // logged-in staff member (e.g. a dietitian only seeing her own
    // clients) instead of trusting a URL param — see helper/
    // dietitianScope.js and Command Center punch-list item 2. Previously
    // this middleware only ever checked "not a plain User" and threw the
    // userType away, so every controller had to re-fetch it (or, more
    // often, didn't bother and left the data unscoped).
    req.user.userType = user.userType;
    return next();
  }

  return res.json(ApiResponse("0", "You are not authorized!", {}));
};

module.exports = { validateAdmin };
