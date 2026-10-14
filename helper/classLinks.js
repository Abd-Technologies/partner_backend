// Class rooms — one truth for "where is this class held".
//
//   • Admin sets each trainer's Zoom room ONCE (Users.zoomRoom).
//   • Every class she teaches uses it (Slots.trainerLink is a server-kept
//     copy, see models/Slot.js).
//   • On a bad day the trainer can set an "Other link" for TODAY only
//     (Slots.backupLink + backupLinkDate).
//   • Users only ever receive the link while the class is live.
const moment = require("moment-timezone");

const PKT = "Asia/Karachi";
const todayPkt = () => moment.tz(PKT).format("YYYY-MM-DD");

/**
 * "812 3456 7890", "812-3456-7890", "https://us06web.zoom.us/j/81234567890?pwd=…"
 * → "81234567890". Returns null when it isn't a valid Zoom meeting number
 * (9–11 digits).
 */
function normalizeZoomRoom(input) {
  if (input == null) return null;
  let s = String(input).trim();
  const m = s.match(/zoom\.us\/(?:j|wc\/join|s)\/(\d{9,11})/i);
  if (m) s = m[1];
  s = s.replace(/[\s-]/g, "");
  return /^\d{9,11}$/.test(s) ? s : null;
}

/**
 * A backup link: a web link (https://…, e.g. Google Meet) or a Zoom
 * meeting number. Zoom numbers are accepted because trainers on OLD app
 * versions still paste their Zoom number into the old "Paste Link" box.
 */
function normalizeBackupLink(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const zoom = normalizeZoomRoom(s);
  if (zoom) return zoom;
  if (!/^https:\/\/\S+\.\S+/i.test(s)) return null;
  return s;
}

/** A link the trainer's phone can open (Zoom app as host, or the web link). */
function openableLink(link) {
  if (!link) return null;
  return /^\d{9,11}$/.test(link) ? `https://zoom.us/j/${link}` : link;
}

module.exports = { PKT, todayPkt, normalizeZoomRoom, normalizeBackupLink, openableLink };
