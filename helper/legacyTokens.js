// Who is still using an old (no-expiry) login token — Nov 2026.
//
// Old tokens stop working after LEGACY_TOKEN_UNTIL (default 31 Dec 2026).
// verifyAccess already swaps them for 30-day tokens via the x-new-token
// header, but app builds that ignore that header keep sending the old one.
// This records those users so an admin can see them and push "please
// update the app" before the cutoff.
//
//   note(userId)   called by verifyAccess on every legacy-token request
//                  (written at most once an hour per user)
//   list()         { cutoff, daysLeft, count, users: [...] }
//   notify()       push an update reminder to every listed user with a device
const { legacyUntilMs } = require("./authToken");

const seen = new Map(); // userId -> last write ms
let tableReady = false;

async function db() {
  const models = require("../models");
  const q = models.sequelize;
  if (!tableReady) {
    await q.query(`CREATE TABLE IF NOT EXISTS legacy_token_use (
      userId    INT NOT NULL PRIMARY KEY,
      firstSeen DATETIME NOT NULL,
      lastSeen  DATETIME NOT NULL,
      hits      INT NOT NULL DEFAULT 1
    )`);
    tableReady = true;
  }
  return q;
}

function note(userId) {
  if (userId == null) return;
  const now = Date.now();
  const last = seen.get(String(userId));
  if (last && now - last < 60 * 60 * 1000) return;
  seen.set(String(userId), now);
  db()
    .then((q) => q.query(
      `INSERT INTO legacy_token_use (userId, firstSeen, lastSeen, hits) VALUES (?, NOW(), NOW(), 1)
       ON DUPLICATE KEY UPDATE lastSeen = NOW(), hits = hits + 1`,
      { replacements: [Number(userId)] }
    ))
    .catch((e) => console.warn("[legacyTokens] note:", e.message));
}

async function list() {
  const q = await db();
  const [rows] = await q.query(`
    SELECT l.userId, l.firstSeen, l.lastSeen, l.hits,
           u.firstName, u.lastName, u.email, u.appVersion, u.appPlatform,
           (u.deviceToken IS NOT NULL) AS hasDevice
      FROM legacy_token_use l
      JOIN Users u ON u.id = l.userId
     WHERE l.lastSeen >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     ORDER BY l.lastSeen DESC`);
  const cutoff = new Date(legacyUntilMs());
  return {
    cutoff: cutoff.toISOString(),
    daysLeft: Math.max(0, Math.ceil((cutoff.getTime() - Date.now()) / 86400000)),
    count: rows.length,
    users: rows,
  };
}

async function notify() {
  const q = await db();
  const [rows] = await q.query(`
    SELECT u.deviceToken FROM legacy_token_use l JOIN Users u ON u.id = l.userId
     WHERE l.lastSeen >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND u.deviceToken IS NOT NULL`);
  const tokens = rows.map((r) => r.deviceToken).filter(Boolean);
  if (!tokens.length) return { sent: 0 };
  await require("./notification")(
    tokens,
    { title: "Please update Fit Her", body: "Update the app from the store to stay signed in after 31 December." },
    { type: "app_update", required: "1" }
  );
  return { sent: tokens.length };
}

module.exports = { note, list, notify };
