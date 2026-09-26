'use strict';
/**
 * GET /trial?token=...  (public)
 *
 * Landing page for a rep's free trial invite link. On Android with the
 * app installed, the verified App Link opens the app directly and this
 * page is never seen. It shows when:
 *   - the app is not installed yet  -> "Get the app" (store)
 *   - the link was opened inside a browser that doesn't hand off
 *     App Links                      -> "Open the app"
 *
 * The Play Store link carries the token as an install referrer
 * (referrer=trial_token=<token>), so after installing, the app reads it
 * on first launch and the invite is not lost.
 *
 * Optional .env:
 *   APP_STORE_URL   iOS App Store link. The iPhone button is hidden
 *                   when it's not set.
 */
const { TrialToken, User } = require('../../models');
const { getTrialDays } = require('../../helper/trialState');

const ANDROID_PACKAGE = 'com.abtechnologies.fitHer';
const LINK_HOST = 'backend.thefither.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function tokenState(token) {
  if (!token) return { ok: false, reason: 'missing' };
  const row = await TrialToken.findOne({ where: { token } });
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.status === 'revoked') return { ok: false, reason: 'invalid' };
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    return { ok: false, reason: 'expired' };
  }
  if (row.status === 'used' && row.usedByUserId != null) {
    return { ok: false, reason: 'used' };
  }
  let repName = null;
  if (row.referrerUserId) {
    const rep = await User.findByPk(row.referrerUserId, {
      attributes: ['firstName'],
    });
    repName = rep && rep.firstName ? rep.firstName : null;
  }
  return { ok: true, repName };
}

async function trialLandingPage(req, res) {
  const token = String((req.query && req.query.token) || '').trim();
  let state;
  try {
    state = await tokenState(token);
  } catch (e) {
    state = { ok: false, reason: 'invalid' };
  }

  const days = getTrialDays();
  const referrer = encodeURIComponent(`trial_token=${token}`);
  const playUrl = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}${
    state.ok ? `&referrer=${referrer}` : ''
  }`;
  // Android intent: opens the app if installed, otherwise the store
  // (with the invite attached).
  const intentUrl =
    `intent://${LINK_HOST}/trial?token=${encodeURIComponent(token)}` +
    `#Intent;scheme=https;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(playUrl)};end`;
  const appStoreUrl = process.env.APP_STORE_URL || '';

  const headline = state.ok
    ? `Your ${days}-day free trial is ready 💚`
    : state.reason === 'used'
      ? 'This invite has already been used'
      : state.reason === 'expired'
        ? 'This invite has expired'
        : 'Welcome to Fit Her 💚';
  const sub = state.ok
    ? `${state.repName ? esc(state.repName) + ' invited you. ' : ''}Get your own AI meal plan and live classes with women trainers, free for ${days} days.`
    : 'No problem, you can still start your free trial from inside the app.';

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fit Her · Free trial</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Poppins,system-ui,sans-serif;background:#E8F4E0;color:#163220;min-height:100vh;display:flex;justify-content:center}
.wrap{width:100%;max-width:440px;padding:20px}
.hero{background:linear-gradient(135deg,#163220,#24502F);border-radius:26px;padding:28px 22px;color:#fff;box-shadow:0 10px 24px rgba(22,50,32,.25)}
.badge{display:inline-block;background:#6DC55A;color:#fff;font-size:11px;font-weight:800;letter-spacing:1px;padding:6px 12px;border-radius:20px}
h1{font-size:26px;line-height:1.2;font-weight:800;margin:16px 0 10px}
.sub{font-size:14px;line-height:1.55;color:rgba(255,255,255,.82)}
.trust{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 4px}
.trust span{font-size:12px;font-weight:600;background:#fff;border:1px solid #D8EDD4;border-radius:20px;padding:7px 11px}
.tile{display:flex;gap:12px;background:#fff;border:1px solid #D8EDD4;border-radius:18px;padding:14px;margin-top:10px}
.tile .i{width:44px;height:44px;border-radius:14px;background:#EAF7E4;display:flex;align-items:center;justify-content:center;font-size:22px;flex:none}
.tile b{display:block;font-size:14px}.tile small{font-size:12.5px;color:#6F8B7A;line-height:1.45}
.btn{display:block;text-align:center;text-decoration:none;font-weight:700;font-size:15px;border-radius:16px;padding:16px;margin-top:12px}
.primary{background:#6DC55A;color:#fff}.dark{background:#163220;color:#fff}.ghost{color:#6F8B7A;font-size:13px}
.note{font-size:12px;color:#6F8B7A;text-align:center;margin-top:14px;line-height:1.5}
</style></head><body><div class="wrap">
<div class="hero">
  <span class="badge">${days} DAYS FREE</span>
  <h1>${headline}</h1>
  <p class="sub">${sub}</p>
</div>
<div class="trust"><span>👩 Women only</span><span>🔒 Private &amp; safe</span><span>📵 Never recorded</span></div>
<div class="tile"><div class="i">🥗</div><div><b>Your own AI meal plan</b><small>Built around your goal, cycle and health.</small></div></div>
<div class="tile"><div class="i">🏋️‍♀️</div><div><b>Live workout classes</b><small>Join real women trainers live, from home.</small></div></div>
<a class="btn primary" id="android" href="${esc(intentUrl)}">Get the app</a>
${appStoreUrl ? `<a class="btn dark" id="ios" href="${esc(appStoreUrl)}">Get it on iPhone</a>` : ''}
<a class="btn ghost" href="${esc(playUrl)}">Open Google Play instead</a>
<p class="note">After installing, open Fit Her and sign up. Your free trial will be waiting for you.</p>
</div>
<script>
// iPhone: show the App Store button first; Android keeps the intent link.
(function(){var ua=navigator.userAgent||'';var ios=/iPhone|iPad|iPod/.test(ua);
var a=document.getElementById('android');var i=document.getElementById('ios');
if(ios&&a){a.style.display='none';}
if(!ios&&i){i.style.display='none';}})();
</script>
</body></html>`);
}

module.exports = { trialLandingPage };
