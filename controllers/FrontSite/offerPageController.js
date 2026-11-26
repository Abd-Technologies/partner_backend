'use strict';
/**
 * GET /offer/:key  (public, no login)
 *
 * Campaign offer page sent on WhatsApp. Everything shown is real, read live:
 *   - packages: the app's own price struck out + the campaign price
 *   - proof: women who trained live this week, average class rating,
 *     result images from the Testimonials table (each hidden when too small)
 *   - trainers with their photos, the class timetable, the next live class
 *   - a countdown to the offer's end (config/offers.json → endsAt)
 * "Claim on WhatsApp" opens a chat with the chosen package already written.
 * Optional ?n=<first name> greets her by name ("Hi Ayesha").
 *
 * Phase 2 (later): choose package → pay on this page.
 * Read-only: this page never writes to the database.
 */
const {
  loadOffer, offerPackages, classTimetable, daysLabel, proof, nextClass, fileUrl,
} = require('../../helper/offerData');
const { LOGO_ON_DARK, LOGO_ON_LIGHT } = require('../../helper/offerAssets');
const { wheelCss, introHtml, wheelScript } = require('../../helper/offerWheel');

const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://backend.thefither.com').replace(/\/+$/, '');
const ICON_PATHS = {
  class: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  diet: '<path d="M4 12h16a8 8 0 0 1-16 0Z"/><path d="M12 12c0-4 2-7 6-8-1 4-3 6-6 8Z"/>',
  consult: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  progress: '<path d="M4 18l6-6 4 4 6-8"/><path d="M15 8h5v5"/>',
  cycle: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  community: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19a6 6 0 0 1 12 0M14.5 19a4.5 4.5 0 0 1 6.5-4"/>',
  Morning: '<path d="M3 18h18M6 18a6 6 0 0 1 12 0"/><path d="M12 5v4M5 10l1.5 1.5M19 10l-1.5 1.5"/>',
  Afternoon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  Evening: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
};
/** Line icon by key, or the text given (an emoji) when there is no such icon. */
const icon = (k) => ICON_PATHS[k]
  ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[k]}</svg>`
  : esc(k || '');
const LINE_SEPS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const money = (n, cur) => `${cur || 'PKR'} ${Number(n || 0).toLocaleString('en-US')}`;
// JSON inside <script>: never let data close the tag.
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(LINE_SEPS, '');

/** "ayesha khan" → "Ayesha". Letters only; anything else is ignored. */
function firstName(raw) {
  const s = String(raw || '').trim().split(/\s+/)[0] || '';
  if (!/^[\p{L}]{2,20}$/u.test(s)) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Round photo with the initial underneath (shows if the photo fails). */
function avatar(name, img, cls = '') {
  const initial = esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span class="av ${cls}" aria-hidden="true">${initial}${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

function notFoundPage(res) {
  res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fit Her</title><style>body{font-family:Poppins,system-ui,sans-serif;background:#E8F4E0;color:#163220;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}</style></head>
<body><div><h1 style="font-size:22px">This offer link isn't available</h1>
<p>It may have been typed wrong. Message us on WhatsApp and we'll share the current plans.</p></div></body></html>`);
}

async function offerPage(req, res) {
  const offer = loadOffer(req.params.key);
  if (!offer) return notFoundPage(res);

  let plans = [];
  let tt = { classes: [], trainers: [], total: 0, perDay: 0 };
  let pr = { womenThisWeek: null, ratingAvg: null, ratingCount: null, results: [] };
  try {
    [plans, tt, pr] = await Promise.all([
      offerPackages(offer),
      classTimetable().catch((e) => { console.error('[offer] timetable:', e.message); return tt; }),
      proof().catch((e) => { console.error('[offer] proof:', e.message); return pr; }),
    ]);
  } catch (e) {
    console.error('[offer] packages:', e.message);
  }

  const name = firstName(req.query.n);
  const ended = offer.ended;
  const anyDiscount = plans.some((p) => p.packages.some((x) => x.offerPrice != null));
  const highlight = String(offer.highlight || '');
  const maxPct = Math.max(0, ...plans.flatMap((p) => p.packages.map((x) => x.savePct || 0)));
  const features = Array.isArray(offer.features) ? offer.features : [];
  const goals = Array.isArray(offer.goals) ? offer.goals.slice(0, 5) : [];
  const heroImage = offer.heroImage ? fileUrl(offer.heroImage) : null;
  const next = nextClass(tt.classes);
  const trainers = (tt.trainers || []).slice(0, 8);
  const allResults = (pr.results || []).slice(0, 8);
  // Full rows of 4 on desktop; 1-3 are shown as they are.
  const results = allResults.length >= 4 ? allResults.slice(0, Math.floor(allResults.length / 4) * 4) : allResults;

  // Preview text WhatsApp shows under the link.
  const best = plans[0] && (plans[0].packages.find((x) => String(x.months) === highlight) || plans[0].packages[plans[0].packages.length - 1]);
  const ogTitle = best && best.offerPrice != null
    ? `Fit Her: ${best.label} for ${money(best.offerPrice, plans[0].currency)}`
    : 'Fit Her: plans and live classes';
  const ogDesc = ended ? 'Women-only live classes and your own diet plan.' : (offer.subtitle || 'Women-only live classes and your own diet plan.');

  const parts = ['Morning', 'Afternoon', 'Evening']
    .map((p) => ({ part: p, rows: tt.classes.filter((c) => c.part === p) }))
    .filter((g) => g.rows.length);

  const page = {
    plans: plans.map((p) => ({
      id: p.planId, title: p.title, currency: p.currency,
      packages: p.packages.map((x) => ({ m: x.months, label: x.label, list: x.listPrice, offer: x.offerPrice, pay: x.pay, save: x.save, pct: x.savePct, pm: x.perMonth })),
    })),
    highlight,
    endsAt: offer.endsAt ? offer.endsAt.toISOString() : null,
    ended,
    serverNow: Date.now(),
    wa: String(offer.whatsapp || '').replace(/\D/g, ''),
    name,
  };

  // Proof lines: only what is real and big enough.
  const proofBits = [];
  if (pr.womenThisWeek) proofBits.push(`<li><b>${pr.womenThisWeek.toLocaleString('en-US')}</b><span>women trained live this week</span></li>`);
  if (pr.ratingAvg) proofBits.push(`<li><b>${pr.ratingAvg.toFixed(1)}<i class="star" aria-hidden="true">★</i></b><span>from ${pr.ratingCount.toLocaleString('en-US')} class ratings</span></li>`);
  if (tt.perDay) proofBits.push(`<li><b>${tt.perDay}</b><span>live classes every day</span></li>`);

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.send(`<!doctype html>
<html lang="en" class="intro-on"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(`${PUBLIC_BASE}/offer/${offer.key}`)}">
${heroImage || results[0] ? `<meta property="og:image" content="${esc(heroImage || results[0])}">` : ''}
<meta name="theme-color" content="#163220">
<script>(function(){var d=document.documentElement,skip=false;try{skip=sessionStorage.getItem('fh_offer_intro')==='1';}catch(e){}if(skip||(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){d.classList.remove('intro-on');d.classList.add('no-intro');}})();</script>
<noscript><style>.intro{display:none}html.intro-on{overflow:auto}</style></noscript>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@300&family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--forest:#163220;--forest-2:#1E4029;--leaf:#6DC55A;--leaf-ink:#2F7A22;--mint:#E8F4E0;--mint-line:#D3E8CB;--muted:#4A6655;--rose:#C2365A;--paper:#fff;--on-dark:#B9D3BF}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:Poppins,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--mint);color:var(--forest);line-height:1.55;font-size:15px}
img{display:block;max-width:100%}
:focus-visible{outline:3px solid var(--leaf);outline-offset:2px;border-radius:8px}
.wrap{max-width:1080px;margin:0 auto;padding:0 18px}

/* Countdown */
.timer{position:sticky;top:0;z-index:20;background:#0F2617;color:#fff;padding:9px 16px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:13px}
.timer .clock{display:flex;gap:6px;font-variant-numeric:tabular-nums}
.timer .u{display:flex;align-items:baseline;gap:2px}
.timer .u b{font-size:17px;font-weight:800;min-width:1.4em;text-align:right;color:#fff}
.timer .u i{font-style:normal;font-size:11px;color:var(--on-dark)}
.timer.over{background:#3A4A40}

/* Avatars */
.av{position:relative;display:inline-grid;place-items:center;width:var(--s,40px);height:var(--s,40px);border-radius:50%;background:var(--leaf);color:var(--forest);font-weight:800;font-size:calc(var(--s,40px)*.4);flex:none;overflow:hidden}
.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}

/* Hero */
.hero{background:var(--forest);color:#fff;position:relative;overflow:hidden}
.hero.photo{background:linear-gradient(180deg,rgba(15,38,23,.55) 0%,rgba(22,50,32,.92) 55%,var(--forest) 100%),var(--hero) center/cover no-repeat}
@media(min-width:900px){.hero.photo{background:linear-gradient(90deg,var(--forest) 0%,rgba(22,50,32,.94) 48%,rgba(22,50,32,.35) 100%),var(--hero) center/cover no-repeat}}
.bub{position:absolute;border-radius:50%;background:rgba(200,232,192,.11);pointer-events:none;animation:bubIn .6s cubic-bezier(.34,1.56,.64,1) both,float 2.2s .6s ease-in-out infinite alternate}
.bub.b1{width:300px;height:300px;top:-110px;right:-90px}
.bub.b2{width:200px;height:200px;bottom:-70px;left:-70px;background:rgba(200,232,192,.07)}
@media(min-width:900px){.bub.b1{width:420px;height:420px;top:-160px;right:-120px}.bub.b2{left:auto;right:42%;bottom:-90px}}
@keyframes bubIn{from{transform:scale(0)}to{transform:scale(1)}}
@keyframes float{from{transform:translateY(-6px) scale(1)}to{transform:translateY(6px) scale(1.04)}}
.hero .wrap{position:relative;z-index:1;display:grid;gap:20px;padding-top:18px;padding-bottom:24px}
.hero .wrap > *{min-width:0}
@media(min-width:900px){.hero .wrap{grid-template-columns:1fr 440px;gap:56px;padding-top:44px;padding-bottom:64px;align-items:start}}
.brand{display:flex;align-items:center;gap:14px}
.logo{display:block;height:19px;width:auto;animation:logoIn .7s .05s both}
@media(min-width:900px){.logo{height:22px}}
@keyframes logoIn{0%{opacity:0;transform:scale(.7)}35%{opacity:1;transform:scale(1.07)}60%{transform:scale(.97)}80%{transform:scale(1.015)}100%{opacity:1;transform:scale(1)}}
.rise{animation:rise .5s cubic-bezier(.2,.7,.3,1) both}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.hello{margin-top:18px;font-size:15px;color:var(--leaf);font-weight:600}
h1{font-size:clamp(30px,8.2vw,58px);line-height:1.02;font-weight:800;letter-spacing:-.025em;margin-top:6px;max-width:12ch}
.sub{margin-top:10px;font-size:15px;color:var(--on-dark);max-width:42ch}
@media(min-width:900px){.sub{font-size:16px;margin-top:14px}}
.goals{list-style:none;display:flex;gap:6px;margin-top:14px;overflow-x:auto;scrollbar-width:none;margin-right:-18px;padding-right:18px}
.goals::-webkit-scrollbar{display:none}
@media(min-width:900px){.goals{flex-wrap:wrap;overflow:visible;margin-right:0;padding-right:0;gap:8px;margin-top:18px}}
.goals li{white-space:nowrap;font-size:12.5px;font-weight:600;padding:5px 11px;border-radius:999px;border:1px solid rgba(185,211,191,.4);color:#fff}
.goals li.lead{border:0;padding-left:0;color:var(--on-dark);font-weight:400}
.stats{list-style:none;display:grid;grid-template-columns:repeat(var(--n),1fr);margin-top:18px;padding-top:14px;border-top:1px solid rgba(185,211,191,.2);max-width:460px}
.stats li{padding-right:10px;min-width:0}
.stats li+li{border-left:1px solid rgba(185,211,191,.2);padding-left:12px}
.stats b{display:flex;align-items:center;gap:4px;font-size:22px;font-weight:800;color:#fff;line-height:1.1}
.stats b .star{color:#F5C451;font-size:16px}
.stats span{display:block;font-size:12px;line-height:1.35;color:var(--on-dark);margin-top:3px}
.next{display:flex;align-items:center;gap:14px;margin-top:18px;background:var(--forest);color:#fff;border-radius:20px;padding:12px 18px 12px 12px;max-width:440px}
.next .av{--s:52px;border:2px solid var(--leaf)}
.next small{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--on-dark)}
.next small::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--leaf);box-shadow:0 0 0 0 rgba(109,197,90,.7);animation:pulse 2s infinite}
@keyframes pulse{70%{box-shadow:0 0 0 8px rgba(109,197,90,0)}100%{box-shadow:0 0 0 0 rgba(109,197,90,0)}}
.next b{display:block;font-size:15px;line-height:1.35}
.faces{display:flex;margin-top:22px}
.faces .av{--s:40px;border:2px solid var(--forest);margin-left:-10px}
.faces .av:first-child{margin-left:0}

/* Package picker: the bold moment */
.picker{background:var(--paper);color:var(--forest);border-radius:28px;padding:22px 18px 18px;box-shadow:0 24px 50px -28px rgba(0,0,0,.55)}

@media(min-width:900px){.picker{position:sticky;top:60px}}
.picker h2{font-size:18px;font-weight:800}
.picker .hint{font-size:13px;color:var(--muted);margin-top:2px}
.plans{display:flex;gap:6px;margin-top:14px;background:var(--mint);padding:4px;border-radius:14px;overflow-x:auto}
.plans button{flex:1;min-width:max-content;border:0;background:transparent;font:inherit;font-size:13px;font-weight:600;color:var(--muted);padding:9px 12px;border-radius:11px;cursor:pointer}
.plans button[aria-pressed="true"]{background:var(--paper);color:var(--forest);box-shadow:0 1px 3px rgba(22,50,32,.15)}
.pkgs{display:grid;gap:14px;margin-top:16px}
.pkg{position:relative;display:grid;grid-template-columns:auto 1fr auto;gap:4px 14px;align-items:center;border:2px solid var(--mint-line);border-radius:20px;padding:18px 16px 16px;cursor:pointer;background:var(--paper);transition:border-color .15s,background .15s}
.pkg input{position:absolute;opacity:0;pointer-events:none}
.pkg .dot{grid-row:1/3;width:22px;height:22px;border-radius:50%;border:2px solid var(--mint-line);display:grid;place-items:center}
.pkg .dot::after{content:"";width:10px;height:10px;border-radius:50%;background:transparent}
.pkg.on{border-color:var(--forest);background:#FBFDF9}
.pkg.on .dot{border-color:var(--forest)}.pkg.on .dot::after{background:var(--forest)}
.pkg:focus-within{outline:3px solid var(--leaf);outline-offset:2px}
.pkg .len{font-weight:800;font-size:17px}
.pkg .pm{grid-column:2;font-size:13px;color:var(--muted)}
.pkg .prices{grid-row:1/3;grid-column:3;text-align:right}
.was{position:relative;display:inline-block;font-size:14px;color:var(--muted);font-weight:600;padding:0 2px;white-space:nowrap}
.was svg{position:absolute;left:-4px;top:50%;width:calc(100% + 8px);height:14px;transform:translateY(-50%);overflow:visible;pointer-events:none}
.was path{fill:none;stroke:var(--rose);stroke-width:2.6;stroke-linecap:round;stroke-dasharray:120;stroke-dashoffset:120;animation:strike .55s cubic-bezier(.6,.1,.3,1) .3s forwards}
.pkg:nth-child(2) .was path{animation-delay:.48s}.pkg:nth-child(3) .was path{animation-delay:.66s}
@keyframes strike{to{stroke-dashoffset:0}}
.now{display:block;font-size:clamp(20px,6.4vw,24px);font-weight:800;letter-spacing:-.01em;line-height:1.15;white-space:nowrap}
.save{position:absolute;top:-11px;left:16px;background:var(--rose);color:#fff;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}
.save.best{left:auto;right:16px;background:var(--leaf-ink)}
.cta{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;margin-top:16px;border:0;border-radius:18px;background:var(--leaf);color:var(--forest);font:inherit;font-weight:800;font-size:16px;padding:17px 16px;text-decoration:none;cursor:pointer;box-shadow:0 10px 22px -12px rgba(47,122,34,.9)}
.cta:hover{background:#7ED16C}
.cta svg{width:22px;height:22px;flex:none}
/* Small phones (320-359px): price goes under the package name, so no value is ever squeezed. */
@media(max-width:359px){.picker{padding:20px 14px 16px}.pkg{grid-template-columns:auto 1fr;padding:18px 14px 14px}.pkg .prices{grid-row:auto;grid-column:2;text-align:left;display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 10px;margin-top:6px}.pkg .prices .was{order:2}.cta{font-size:15px;padding:15px 12px}.save.best{right:12px}.bar .cta{padding:12px 14px;font-size:14px}.timer{gap:8px;font-size:12px}}
.ends{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:16px;font-size:13px;color:var(--muted)}
.ends span{width:8px;height:8px;border-radius:50%;background:var(--rose)}
.ends b{color:var(--forest);font-variant-numeric:tabular-nums}
.ends + .cta{margin-top:10px}
.fine{font-size:12px;color:var(--muted);text-align:center;margin-top:10px}
.empty{font-size:14px;color:var(--muted);padding:16px 2px}

/* Sections */
main section{margin-top:60px}
h2.sec{font-size:clamp(22px,5.5vw,28px);font-weight:800;letter-spacing:-.015em;line-height:1.15}
.lead{color:var(--muted);margin-top:6px;max-width:52ch}

.results{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,64%);gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;margin:18px -18px 0;padding:0 18px 8px;scrollbar-width:none}
.results::-webkit-scrollbar{display:none}
@media(min-width:900px){.results{grid-auto-flow:row;grid-template-columns:repeat(4,1fr);grid-auto-columns:auto;margin:18px 0 0;padding:0;overflow:visible}}
.results figure{scroll-snap-align:start;border-radius:22px;overflow:hidden;background:var(--paper);aspect-ratio:4/5}
.results img{width:100%;height:100%;object-fit:cover}

.team{list-style:none;display:flex;gap:18px;overflow-x:auto;margin-top:18px;padding-bottom:6px}
.team li{text-align:center;font-size:13px;font-weight:600;flex:none;width:76px}
.team .av{--s:72px;border:3px solid var(--paper);box-shadow:0 0 0 2px var(--leaf);margin-bottom:8px}

.incl{list-style:none;margin-top:18px;display:grid;background:var(--paper);border-radius:24px;padding:6px 18px}
@media(min-width:700px){.incl{grid-template-columns:1fr 1fr;column-gap:32px}}
.incl li{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--mint)}
.incl .ic{width:44px;height:44px;flex:none;border-radius:14px;background:var(--mint);display:grid;place-items:center;font-size:22px;color:var(--leaf-ink)}
.incl .ic svg{width:22px;height:22px}
.incl b{display:block;font-size:15px}
.incl small{display:block;color:var(--muted);font-size:13px;line-height:1.5}

.tt{margin-top:18px;display:grid;gap:14px}
@media(min-width:800px){.tt{grid-template-columns:repeat(3,1fr)}}
.tt .grp{background:var(--paper);border-radius:24px;padding:16px 18px}
.tt h3{font-size:14px;font-weight:600;color:var(--muted);display:flex;align-items:center;gap:8px}
.tt h3 svg{width:18px;height:18px;color:var(--leaf-ink)}
.tt ol{list-style:none;margin-top:8px}
.tt li{display:grid;grid-template-columns:72px 1fr auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--mint)}
.tt li:first-child{border-top:0}
.tt .t{font-weight:800;font-variant-numeric:tabular-nums;font-size:14px}
.tt .c{font-size:14px;font-weight:600;line-height:1.35}
.tt .c small{display:block;font-weight:400;color:var(--muted);font-size:12.5px}
.tt .av{--s:32px}

.steps{list-style:none;margin-top:18px;display:grid;gap:14px;counter-reset:s}
@media(min-width:800px){.steps{grid-template-columns:repeat(3,1fr)}}
.steps li{counter-increment:s;display:flex;gap:14px;align-items:flex-start}
.steps li::before{content:counter(s);flex:none;width:34px;height:34px;border-radius:50%;background:var(--forest);color:var(--leaf);font-weight:800;display:grid;place-items:center}
.steps b{display:block}.steps small{color:var(--muted);font-size:13.5px}

.close{margin-top:64px;background:var(--forest);color:#fff;border-radius:28px;padding:28px 22px;text-align:center}
.close h2{font-size:24px;font-weight:800;line-height:1.2}
.close p{color:var(--on-dark);margin-top:8px}
.close .cta{max-width:380px;margin:18px auto 0}
footer{margin:36px 0 0;font-size:12px;color:var(--muted);text-align:center;display:grid;justify-items:center;gap:4px}
footer img{height:15px;width:auto;margin-bottom:6px;opacity:.85}
.close-logo{height:18px;width:auto;margin:0 auto 14px}
main{padding-bottom:120px}

/* Sticky claim bar on phones */
.bar{position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(255,255,255,.97);backdrop-filter:blur(8px);border-top:1px solid var(--mint-line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px;transform:translateY(110%);transition:transform .25s}
.bar.show{transform:none}
.bar .sum{flex:1;min-width:0;font-size:13px;line-height:1.3;color:var(--muted)}
.bar .sum b{display:block;font-size:16px;color:var(--forest)}
.bar .cta{width:auto;margin:0;padding:13px 18px;font-size:15px;box-shadow:none}
@media(min-width:900px){.bar{display:none}}

@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.was path{stroke-dashoffset:0}}
${wheelCss}
</style>
</head>
<body>
${introHtml(LOGO_ON_LIGHT)}

<div class="timer${ended ? ' over' : ''}" role="status" aria-live="off">
  ${ended
    ? '<span>This offer has ended. Normal prices are shown below.</span>'
    : offer.endsAt
      ? `<span>Offer ends in</span><span class="clock" aria-label="Time left">
          <span class="u"><b id="cd">--</b><i>d</i></span><span class="u"><b id="ch">--</b><i>h</i></span>
          <span class="u"><b id="cm">--</b><i>m</i></span><span class="u"><b id="cs">--</b><i>s</i></span></span>`
      : '<span>Limited time offer</span>'}
</div>

<header class="hero${heroImage ? ' photo' : ''}"${heroImage ? ` style="--hero:url('${esc(heroImage)}')"` : ''}>
  <span class="bub b1" aria-hidden="true"></span><span class="bub b2" aria-hidden="true"></span>
  <div class="wrap">
    <div>
      <div class="brand"><img class="logo" src="${LOGO_ON_DARK}" alt="Fit Her" width="129" height="19"></div>
      ${name ? `<p class="hello rise" style="animation-delay:.12s">Hi ${esc(name)}, this one's for you</p>` : ''}
      <h1 class="rise" style="animation-delay:.18s">${esc(ended ? 'Plans and live classes' : offer.title || 'Our best rate is back')}</h1>
      <p class="sub rise" style="animation-delay:.26s">${esc(ended ? 'Women-only live classes and your own diet plan, all in the Fit Her app.' : offer.subtitle || '')}</p>
      ${goals.length ? `<ul class="goals"><li class="lead">Made for</li>${goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
      ${proofBits.length ? `<ul class="stats" style="--n:${proofBits.length}">${proofBits.join('')}</ul>` : ''}
    </div>

    <div class="picker-slot">
      <div class="picker" id="pick">
        <h2>Choose your package</h2>
        <p class="hint">${ended || !anyDiscount ? 'Prices in the Fit Her app.' : `App price crossed out. Save up to ${maxPct}% until the timer runs out.`}</p>
        ${plans.length > 1 ? `<div class="plans" role="group" aria-label="Plan">${plans.map((p, i) => `<button type="button" data-plan="${i}" aria-pressed="${i === 0}">${esc(p.title)}</button>`).join('')}</div>` : ''}
        <div class="pkgs" id="pkgs" role="radiogroup" aria-label="Package">
          ${plans.length ? '' : '<p class="empty">Packages are being updated. Message us on WhatsApp for today\'s prices.</p>'}
        </div>
        ${!ended && offer.endsAt && anyDiscount ? '<p class="ends"><span aria-hidden="true"></span>Offer price ends in <b id="pd">soon</b></p>' : ''}
        <a class="cta" id="cta" href="#" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.9-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>
          <span id="ctaText">Claim on WhatsApp</span>
        </a>
        <p class="fine">Opens WhatsApp with your package written in. Our team sends your payment link.</p>
      </div>
    </div>
  </div>
</header>

<main class="wrap">
  ${results.length ? `<section aria-labelledby="res">
    <h2 class="sec" id="res">Real women, real results</h2>
    <p class="lead">Shared by Fit Her members.</p>
    <div class="results">${results.map((u, i) => `<figure><img src="${esc(u)}" alt="Fit Her member result ${i + 1}" loading="lazy" onerror="this.parentNode.remove()"></figure>`).join('')}</div>
  </section>` : ''}

  ${trainers.length > 1 ? `<section aria-labelledby="team">
    <h2 class="sec" id="team">Your trainers are women too</h2>
    <p class="lead">Every class is led live by a woman trainer, and classes are never recorded.</p>
    <ul class="team">${trainers.map((t) => `<li>${avatar(t.name, t.image)}<span>${esc(t.name)}</span></li>`).join('')}</ul>
  </section>` : ''}

  ${parts.length ? `<section aria-labelledby="cls">
    <h2 class="sec" id="cls">${tt.perDay ? `${tt.perDay} live classes a day, pick any` : 'Live class timings'}</h2>
    <p class="lead">Pakistan time. Join from home, whenever fits your day.</p>
    ${next ? `<div class="next">${avatar(next.trainer || next.type, next.trainerImage)}<div><small>Next live class, ${esc(next.when.toLowerCase() === 'today' || next.when.toLowerCase() === 'tomorrow' ? next.when.toLowerCase() : 'on ' + next.when)} at ${esc(next.time)}</small><b>${esc(next.type)}${next.trainer ? ` with ${esc(next.trainer)}` : ''}</b></div></div>` : ''}
    <div class="tt">${parts.map((g) => `<div class="grp"><h3>${icon(g.part)}${g.part}</h3><ol>${g.rows.map((c) => {
      const meta = [c.level, daysLabel(c.days), c.trainer ? `with ${c.trainer}` : null].filter(Boolean).join(', ');
      return `<li><span class="t">${esc(c.time)}</span><span class="c">${esc(c.type)}${meta ? `<small>${esc(meta)}</small>` : ''}</span>${c.trainer ? avatar(c.trainer, c.trainerImage) : '<span></span>'}</li>`;
    }).join('')}</ol></div>`).join('')}</div>
  </section>` : ''}

  ${features.length ? `<section aria-labelledby="inc">
    <h2 class="sec" id="inc">Everything in the app is included</h2>
    <p class="lead">One price for the full Fit Her app, for the whole package.</p>
    <ul class="incl">${features.map((f) => {
      const [ic, title, text] = Array.isArray(f) ? f : [f.icon, f.title, f.text];
      return `<li><span class="ic" aria-hidden="true">${icon(ic || 'class')}</span><span><b>${esc(title)}</b>${text ? `<small>${esc(text)}</small>` : ''}</span></li>`;
    }).join('')}</ul>
  </section>` : ''}

  <section aria-labelledby="how">
    <h2 class="sec" id="how">How to join</h2>
    <ol class="steps">
      <li><span><b>Pick your package</b><small>Choose the length that suits you.</small></span></li>
      <li><span><b>Tap Claim on WhatsApp</b><small>Your package is already written. Our team replies with your secure payment link.</small></span></li>
      <li><span><b>Pay and start</b><small>We set up your diet plan and you join your first live class.</small></span></li>
    </ol>
  </section>

  ${plans.length ? `<div class="close">
    <img class="close-logo" src="${LOGO_ON_DARK}" alt="Fit Her" width="122" height="18">
    <h2>${ended ? 'Ready when you are' : name ? `${esc(name)}, your spot is waiting` : 'Your spot is waiting'}</h2>
    <p>${ended ? 'Message us and we will help you pick a plan.' : 'This price goes back up when the timer ends.'}</p>
    <a class="cta" id="cta2" href="#" target="_blank" rel="noopener"><span id="cta2Text">Claim on WhatsApp</span></a>
  </div>` : ''}

  <footer><img src="${LOGO_ON_LIGHT}" alt="Fit Her" width="107" height="15"><p>Built around every phase of you.</p><p>Prices in ${esc((plans[0] && plans[0].currency) || 'PKR')}.</p></footer>
</main>

<div class="bar" id="bar" aria-hidden="true">
  <div class="sum"><span id="barLen"></span><b id="barPrice"></b></div>
  <a class="cta" id="barCta" href="#" target="_blank" rel="noopener" tabindex="-1">Claim on WhatsApp</a>
</div>

<script>
(function(){
  var D=${safeJson(page)};
  var fmt=function(n,c){return (c||'PKR')+' '+Number(n||0).toLocaleString('en-US');};
  var plan=0, sel=null;
  var $=function(id){return document.getElementById(id);};
  var strike='<svg viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true"><path d="M2 9 C 25 4, 55 11, 98 5"/></svg>';

  function pick(p){
    var pk=p.packages, h=null;
    for(var i=0;i<pk.length;i++){ if(String(pk[i].m)===String(D.highlight)) h=pk[i]; }
    return h||pk[pk.length-1];
  }
  function render(){
    var p=D.plans[plan]; if(!p) return;
    if(!sel||!p.packages.some(function(x){return x.m===sel.m;})) sel=pick(p);
    $('pkgs').innerHTML=p.packages.map(function(x){
      var on=x.m===sel.m;
      var badges=(x.offer!=null?'<span class="save">Save '+fmt(x.save,p.currency)+'</span>':'')+
                 (String(x.m)===String(D.highlight)&&x.offer!=null?'<span class="save best">Best value</span>':'');
      return '<label class="pkg'+(on?' on':'')+'">'+badges+
        '<input type="radio" name="pkg" value="'+x.m+'"'+(on?' checked':'')+'>'+
        '<span class="dot" aria-hidden="true"></span>'+
        '<span class="len">'+x.label+'</span>'+
        '<span class="pm">'+fmt(x.pm,p.currency)+' a month'+(x.offer!=null?', '+x.pct+'% off':'')+'</span>'+
        '<span class="prices">'+(x.offer!=null?'<span class="was">'+fmt(x.list,p.currency)+strike+'</span>':'')+
        '<span class="now">'+fmt(x.pay,p.currency)+'</span></span></label>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#pkgs input'),function(inp){
      inp.addEventListener('change',function(){ sel=p.packages.filter(function(x){return String(x.m)===inp.value;})[0]; render(); });
    });
    updateCta();
  }
  function waLink(){
    var p=D.plans[plan];
    if(!D.wa) return '#';
    if(!sel) return 'https://wa.me/'+D.wa;
    var msg='Hi Fit Her'+(D.name?', this is '+D.name:'')+'. I want the '+sel.label+' package'+
      (D.plans.length>1?' ('+p.title+')':'')+' for '+fmt(sel.pay,p.currency)+(sel.offer!=null&&!D.ended?' (offer price)':'')+'. Please send my payment link.';
    return 'https://wa.me/'+D.wa+'?text='+encodeURIComponent(msg);
  }
  function updateCta(){
    var p=D.plans[plan], url=waLink();
    var small=window.innerWidth<360;
    var txt=sel?((small?'Claim for ':'Get '+sel.label+' for ')+fmt(sel.pay,p.currency)):'Ask us on WhatsApp';
    $('ctaText').textContent=txt; $('cta').href=url; $('barCta').href=url;
    if($('cta2')){ $('cta2').href=url; $('cta2Text').textContent=txt; }
    $('barLen').textContent=sel?sel.label+(sel.offer!=null?', '+sel.pct+'% off':''):'';
    $('barPrice').textContent=sel?fmt(sel.pay,p.currency):'';
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-plan]'),function(b){
    b.addEventListener('click',function(){
      plan=+b.getAttribute('data-plan'); sel=null;
      Array.prototype.forEach.call(document.querySelectorAll('[data-plan]'),function(o){o.setAttribute('aria-pressed',o===b?'true':'false');});
      render();
    });
  });
  if(D.plans.length) render(); else { $('cta').href=D.wa?'https://wa.me/'+D.wa:'#'; }

  // Claim bar on phones whenever the main claim button is off screen
  // (before she scrolls to it, and after she scrolls past it).
  var bar=$('bar'), pickEl=$('cta');
  if('IntersectionObserver' in window && D.plans.length){
    new IntersectionObserver(function(es){ var show=!es[0].isIntersecting; bar.classList.toggle('show',show); bar.setAttribute('aria-hidden',show?'false':'true'); $('barCta').tabIndex=show?0:-1; },{threshold:0}).observe(pickEl);
  }

  // Countdown. At zero, reload: the server then shows normal prices.
  if(D.endsAt && !D.ended && $('cd')){
    // Count on the server's clock, not her phone's (a phone set wrong would show the wrong time left).
    var skew=D.serverNow-Date.now();
    var end=new Date(D.endsAt).getTime(), two=function(n){return (n<10?'0':'')+n;};
    var tick=function(){
      var s=Math.max(0,Math.floor((end-(Date.now()+skew))/1000));
      $('cd').textContent=Math.floor(s/86400); $('ch').textContent=two(Math.floor(s%86400/3600));
      $('cm').textContent=two(Math.floor(s%3600/60)); $('cs').textContent=two(s%60);
      if($('pd')) $('pd').textContent=(s>=86400?Math.floor(s/86400)+'d ':'')+two(Math.floor(s%86400/3600))+'h '+two(Math.floor(s%3600/60))+'m';
      if(s===0){ clearInterval(iv); setTimeout(function(){location.reload();},1500); }
    };
    var iv=setInterval(tick,1000); tick();
  }
})();
</script>
<script>${wheelScript}</script>
</body></html>`);
}

module.exports = { offerPage, firstName };
