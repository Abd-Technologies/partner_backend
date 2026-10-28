// Role and ownership guards for /admin routes (Oct 2026 auth audit).
//
// validateToken  -> "is this a logged-in person?"
// validateAdmin  -> "is this any staff member?" (any userType except "User")
// The helpers below add the two checks that were missing:
//   requireRole("Admin")         -> only these exact user types
//   selfOrStaff("params.userId") -> a User may only touch her OWN record;
//                                   staff may touch anyone's
// All responses keep the app contract: HTTP 200 + { status: "0", ... }.

const ApiResponse = require("../helper/ApiResponse");
const { verifyAccess, renew } = require("../helper/authToken");
const { hasRole, isStaff, ADMIN_ONLY_MSG } = require("../helper/roles");

const deny = (res, msg = "You are not authorized!") =>
  res.json(ApiResponse("0", msg, {}));

// Verifies the accessToken header and loads the user once per request.
// Returns the user row, or null after it has already sent a response.
async function loadUser(req, res) {
  if (req.authUser) return req.authUser;

  const accessToken = req.header("accessToken");
  if (!accessToken) {
    deny(res, "User not loggedIn!");
    return null;
  }

  // helper/authToken.js: expiry, logout revocation, sliding renewal.
  let payload;
  let user;
  try {
    ({ payload, user } = await verifyAccess(accessToken));
  } catch (err) {
    if (!err || !err.code) throw err;
    deny(res, err.code === "NO_USER" ? "User not found!" : "Invalid accessToken!");
    return null;
  }
  renew(res, payload, user);

  req.user = { ...payload, userType: user.userType };
  req.authUser = user;
  return user;
}

// Only the listed user types get through, e.g. requireRole("Admin").
// Compared case/space-insensitively (helper/roles.js), the way MySQL
// matched the account at login: "admin" / "Admin " count as Admin.
function roleGuard(roles, message) {
  return async (req, res, next) => {
    try {
      const user = await loadUser(req, res);
      if (!user) return;
      if (!hasRole(user, roles)) return deny(res, message);
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
function requireRole(...roles) {
  return roleGuard(roles, "You are not authorized!");
}
// Money, plans, team and broadcast actions.
function requireAdmin(req, res, next) {
  return roleGuard([process.env.ADMIN || "Admin"], ADMIN_ONLY_MSG)(req, res, next);
}
// Admin or the sales / customer-support team.
function requireAdminOrSupport(req, res, next) {
  return roleGuard(
    [process.env.ADMIN || "Admin", "Customer_Support_Representative"],
    "Only the Fit Her admin or support team can do this."
  )(req, res, next);
}

// Reads "params.userId" / "body.userId" style paths from the request.
const pick = (req, path) =>
  path.split(".").reduce((obj, key) => (obj == null ? obj : obj[key]), req);

// A plain User may only act on her own id. Staff pass through, unless
// `roles` is given, in which case only those staff types pass.
function selfOrStaff(path, roles = null) {
  return async (req, res, next) => {
    try {
      const user = await loadUser(req, res);
      if (!user) return;

      const target = pick(req, path);
      if (target != null && String(target) === String(user.id)) return next();

      if (isStaff(user) && (!roles || hasRole(user, roles))) return next();

      return deny(res, "You can only see or change your own details.");
    } catch (err) {
      return next(err);
    }
  };
}

// /admin/addUser is both the public signup endpoint and the staff
// "add user" tool. Staff keep full control; anyone else can only create
// a plain inactive account (no free plan via status/planId in the body).
function signupGuard() {
  return async (req, res, next) => {
    try {
      const accessToken = req.header("accessToken");
      if (accessToken) {
        try {
          const { payload, user } = await verifyAccess(accessToken);
          if (user && isStaff(user)) {
            req.user = { ...payload, userType: user.userType };
            return next();
          }
        } catch (err) {
          // Bad or stale token on a signup screen: treat as public signup.
        }
      }

      if (req.body) {
        req.body.status = false;
        delete req.body.planId;
        delete req.body.durationId;
        delete req.body.price;
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

// get_users_based_on_types returns email and phone. Clients use it to list
// dietitians, trainers and specialists, so they may not list "User" or
// "Admin" accounts. Staff can list any type.
function userTypeListGuard() {
  const hiddenFromClients = ["User", "Admin"];
  return async (req, res, next) => {
    try {
      const user = await loadUser(req, res);
      if (!user) return;
      if (
        !isStaff(user) &&
        hasRole({ userType: req.params.userType }, hiddenFromClients)
      ) {
        return deny(res);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  requireRole,
  requireAdmin,
  requireAdminOrSupport,
  selfOrStaff,
  signupGuard,
  userTypeListGuard,
  loadUser,
};
