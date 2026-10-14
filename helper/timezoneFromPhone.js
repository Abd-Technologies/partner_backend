// Time zone for clients on OLD app versions (they never send theirs).
// New apps send the phone's real time zone on every start, which always
// wins — this only fills it in when it's still empty, from the phone's
// country code. Countries with several time zones (+1 USA/Canada, +7,
// +61 Australia, +55 Brazil…) are skipped: Pakistan time stays the
// fallback for them.
const { Op } = require("sequelize");
const { User } = require("../models");

// Longest prefix wins.
const BY_CODE = {
  "92": "Asia/Karachi",
  "971": "Asia/Dubai",
  "966": "Asia/Riyadh",
  "974": "Asia/Qatar",
  "965": "Asia/Kuwait",
  "968": "Asia/Muscat",
  "973": "Asia/Bahrain",
  "91": "Asia/Kolkata",
  "880": "Asia/Dhaka",
  "93": "Asia/Kabul",
  "98": "Asia/Tehran",
  "90": "Europe/Istanbul",
  "44": "Europe/London",
  "353": "Europe/Dublin",
  "49": "Europe/Berlin",
  "33": "Europe/Paris",
  "39": "Europe/Rome",
  "34": "Europe/Madrid",
  "31": "Europe/Amsterdam",
  "46": "Europe/Stockholm",
  "47": "Europe/Oslo",
  "45": "Europe/Copenhagen",
  "41": "Europe/Zurich",
  "43": "Europe/Vienna",
  "32": "Europe/Brussels",
  "60": "Asia/Kuala_Lumpur",
  "65": "Asia/Singapore",
  "64": "Pacific/Auckland",
  "27": "Africa/Johannesburg",
  "20": "Africa/Cairo",
  "962": "Asia/Amman",
  "961": "Asia/Beirut",
  "86": "Asia/Shanghai",
  "81": "Asia/Tokyo",
  "82": "Asia/Seoul",
};

function zoneFromPhone(phone) {
  if (!phone) return null;
  let d = String(phone).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("03") && d.length === 11) return "Asia/Karachi"; // local PK mobile
  else return null;
  for (const len of [3, 2]) {
    const tz = BY_CODE[d.slice(0, len)];
    if (tz) return tz;
  }
  return null;
}

/** Fills User.timeZone where it's empty. Returns how many were set. */
async function backfillTimezonesFromPhone() {
  const users = await User.findAll({
    where: { [Op.or]: [{ timeZone: null }, { timeZone: "" }], phone: { [Op.ne]: null } },
    attributes: ["id", "phone", "timeZone"],
  });
  let set = 0;
  for (const u of users) {
    const tz = zoneFromPhone(u.phone);
    if (!tz) continue;
    await User.update({ timeZone: tz }, { where: { id: u.id, [Op.or]: [{ timeZone: null }, { timeZone: "" }] } });
    set++;
  }
  return set;
}

module.exports = { zoneFromPhone, backfillTimezonesFromPhone };
