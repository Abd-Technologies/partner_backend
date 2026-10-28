// Server-side Mixpanel events (e.g. Purchase, which is decided on the
// server when a payment is approved — the phone never knows).
// Uses the same project token as the app (MIXPANEL_TOKEN in .env).
// Fire-and-forget: never throws, never waits.
const https = require("https");

const TOKEN = () => process.env.MIXPANEL_TOKEN || "14d69695d1cf63e1705033ca2e307088";

function track(distinctId, event, props = {}) {
  try {
    if (!distinctId || process.env.MIXPANEL_DISABLED === "1") return;
    const payload = JSON.stringify([
      {
        event,
        properties: {
          token: TOKEN(),
          distinct_id: String(distinctId),
          time: Math.floor(Date.now() / 1000),
          $insert_id: `${event}-${distinctId}-${props.insert_key || Date.now()}`.slice(0, 36),
          source: "server",
          ...props,
        },
      },
    ]);
    const req = https.request(
      { method: "POST", hostname: "api.mixpanel.com", path: "/track?verbose=1", headers: { "Content-Type": "application/json", Accept: "text/plain" }, timeout: 8000 },
      (res) => res.resume()
    );
    req.on("error", (e) => console.warn("[mixpanel] send failed:", e.message));
    req.on("timeout", () => req.destroy());
    req.end(payload);
  } catch (e) {
    console.warn("[mixpanel] track error:", e.message);
  }
}

module.exports = { track };
