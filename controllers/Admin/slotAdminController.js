// Delete a class slot (admin). Soft delete: the Slot model is paranoid, so
// the slot leaves every schedule but past attendance/feedback stay.
//   POST /admin/slots/:id/delete
const ApiResponse = require("../../helper/ApiResponse");
const { isAdmin, adminsOnlyMessage } = require("../../helper/roles");

exports.remove = async (req, res) => {
  const { User, Slot } = require("../../models");
  const me = await User.findByPk(req.user && req.user.id, { attributes: ["id", "userType"] });
  if (!isAdmin(me)) return res.json(ApiResponse("0", adminsOnlyMessage(me), {}));
  const slot = await Slot.findByPk(req.params.id);
  if (!slot) return res.json(ApiResponse("0", "Slot not found (maybe already deleted)", {}));
  if (String(slot.status || "").toLowerCase() === "live") {
    return res.json(ApiResponse("0", "This class is live right now. End it first, then delete the slot.", {}));
  }
  await slot.destroy();
  console.log(`[slots] slot ${slot.id} (${slot.start}-${slot.end}) deleted by admin ${me.id}`);
  return res.json(ApiResponse("1", "Slot deleted", { id: slot.id }));
};
