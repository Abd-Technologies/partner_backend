// Role checks that match how MySQL compares: case and trailing spaces
// don't matter. Login finds an "admin" or "Admin " account with
// userType = "Admin" (MySQL ignores both), so strict JS checks
// (user.userType === "Admin") wrongly said "Admins only" to real admins.
const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
const ADMIN = () => process.env.ADMIN || "Admin";
const TRAINER = () => process.env.TRAINER || "Trainer";

const CLIENT = () => process.env.USER_TYPE_CLIENT || "User";

const isRole = (user, role) => !!user && norm(user.userType) === norm(role);
const isAdmin = (user) => isRole(user, ADMIN());
const isTrainer = (user) => isRole(user, TRAINER());
/** True when the user's type is one of `roles` (case/space-insensitive). */
const hasRole = (user, roles) =>
  !!user && (roles || []).some((r) => norm(user.userType) === norm(r));
/** Any team member: a real, non-empty type that is not the client type
 *  ("User", "user ", ...). An empty/missing type is NOT staff. */
const isStaff = (user) => {
  const t = norm(user && user.userType);
  return t !== "" && t !== norm(CLIENT());
};

/** "Admins only" + the role we saw, so a wrong account is easy to spot. */
const adminsOnlyMessage = (user) =>
  user ? `Admins only. This account is "${user.userType || "no role"}".` : "Please log in again.";

const ADMIN_ONLY_MSG = "Only the Fit Her admin can do this.";

module.exports = { norm, isRole, isAdmin, isTrainer, hasRole, isStaff, adminsOnlyMessage, ADMIN_ONLY_MSG };
