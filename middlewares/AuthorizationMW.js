const ApiResponse = require("../helper/ApiResponse");
const { verifyAccess, renew } = require("../helper/authToken");

// Oct 2026 security pass: tokens now expire (app 30 days, portal 12 h) and
// are revoked on logout / password change (helper/authToken.js). A valid
// token that is getting old gets a fresh one in the `x-new-token` header.
const validateToken = async (req, res, next) => {
  const accessToken = req.header("accessToken");
  if (!accessToken) {
    const response = ApiResponse("0", "User not loggedIn!", {});
    return res.json(response);
  }
  let auth;
  try {
    auth = await verifyAccess(accessToken);
  } catch (err) {
    if (err && err.code) {
      const response = ApiResponse("0", "Invalid accessToken!", {});
      return res.json(response);
    }
    return next(err);
  }
  req.user = auth.payload;
  req.accessTokenRaw = accessToken;
  renew(res, auth.payload, auth.user);
  return next();
};

module.exports = { validateToken };
