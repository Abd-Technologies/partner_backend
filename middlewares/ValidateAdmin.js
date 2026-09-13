const { verify } = require("jsonwebtoken");
const ApiResponse = require("../helper/ApiResponse");
const { User } = require("../models");

const validateAdmin = async (req, res, next) => {
  const accessToken = req.header("accessToken");
  if (!accessToken) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  // Bug A fix: verify() throws JsonWebTokenError / TokenExpiredError on invalid
  // or expired tokens. Without try/catch this was an unhandled async throw in
  // Express 4 middleware, crashing the server process instead of returning JSON.
  let validToken;
  try {
    validToken = verify(accessToken, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    return res.json(ApiResponse("0", "Invalid accessToken!", {}));
  }

  req.user = validToken;

  // Bug B fix: User.findOne can return null (deleted account, stale token).
  // Accessing user.userType on null threw TypeError — crash same path as Bug A.
  const user = await User.findOne({ where: { id: req.user.id } });
  if (!user) {
    return res.json(ApiResponse("0", "User not found!", {}));
  }

  if (user.userType !== "User") {
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
