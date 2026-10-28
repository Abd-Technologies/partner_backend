// Chat push notification, sent by the server (the phone app used to hold a
// Google service-account key to send these itself — that key is removed).
//   POST /users/chat/notify  { toUserId, text }
// Rules: sender must be logged in. A client can only notify a team member;
// team members can notify anyone. One push per sender->receiver per 20 s.
const ApiResponse = require("../../helper/ApiResponse");

const M = () => require("../../models");
const lastSent = new Map(); // "from:to" -> ms
const GAP_MS = 20 * 1000;

exports.notify = async (req, res) => {
  try {
    const fromId = req.user && req.user.id;
    const toId = parseInt(req.body && req.body.toUserId, 10);
    const text = String((req.body && req.body.text) || "").trim();
    if (!fromId || !toId || !text) return res.json(ApiResponse("0", "Missing receiver or text", {}));
    if (String(fromId) === String(toId)) return res.json(ApiResponse("1", "Skipped", {}));

    const { User } = M();
    const [from, to] = await Promise.all([
      User.findByPk(fromId, { attributes: ["id", "firstName", "lastName", "userType"] }),
      User.findByPk(toId, { attributes: ["id", "userType", "deviceToken"] }),
    ]);
    if (!from || !to) return res.json(ApiResponse("0", "User not found", {}));
    if (from.userType === "User" && to.userType === "User") {
      return res.json(ApiResponse("0", "Not allowed", {}));
    }

    const key = `${fromId}:${toId}`;
    const now = Date.now();
    if (now - (lastSent.get(key) || 0) < GAP_MS) return res.json(ApiResponse("1", "Sent recently", {}));
    lastSent.set(key, now);
    if (lastSent.size > 5000) lastSent.clear();

    if (!to.deviceToken) return res.json(ApiResponse("1", "No device", {}));
    const name = `${from.firstName || ""} ${from.lastName || ""}`.trim() || "Fit Her";
    const body = text.length > 120 ? text.slice(0, 117) + "..." : text;
    const sendNotification = require("../../helper/notification");
    await sendNotification([to.deviceToken], { title: "A new message arrived", body: `${name}: ${body}` }, {
      type: "chat",
      fromUserId: String(fromId),
    });
    return res.json(ApiResponse("1", "Sent", {}));
  } catch (e) {
    console.error("[chatNotify]", e.message);
    return res.json(ApiResponse("0", "Couldn't send notification", {}));
  }
};
