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
    return next();
  }

  return res.json(ApiResponse("0", "You are not authorized!", {}));
};

module.exports = { validateAdmin };
