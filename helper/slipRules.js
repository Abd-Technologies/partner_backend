// Payment slip rules (Oct 2026). A slip is approved automatically only
// when ALL of these are true; otherwise it waits for the admin with the
// exact reason:
//   1. It shows one of Fit Her's active payment accounts (admin list).
//   2. A transaction / reference number was found (and never used before:
//      checked by the caller).
//   3. The slip date is within the last MAX_SLIP_AGE_DAYS days (PKT).
//   4. Nov 2026: the amount is checked again, against a price the SERVER
//      knows (the rep's payment request / link, or the plan's real price or
//      her trial-offer price for an in-app upload — never a number the phone
//      sends). Up to AMOUNT_TOLERANCE_PKR short is fine; more short, or an
//      amount that can't be read, waits for the admin ("Paid 2,000 of 4,500").
const moment = require("moment-timezone");
const { listActive, matchAccount, digitsOnly } = require("./paymentAccounts");

const TZ = "Asia/Karachi";
// Oct 2026: 4 days (was 3).
const MAX_SLIP_AGE_DAYS = 4;
const AMOUNT_TOLERANCE_PKR = 50;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "16/10/2026", "16-Oct-2026", "16 October 26", "2026-10-16" → moment (PKT) or null. Day comes first (Pakistan). */
function parseSlipDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  let d, m, y;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  if (!r && (r = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s))) [d, m, y] = [+r[1], +r[2], +r[3]];
  if (!r && (r = /^(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-,]+(\d{2,4})/.exec(s))) {
    const mi = MONTHS.indexOf(r[2].slice(0, 3).toLowerCase());
    if (mi < 0) return null;
    [d, m, y] = [+r[1], mi + 1, +r[3]];
  }
  if (!r) return null;
  if (y < 100) y += 2000;
  const mm = moment.tz({ year: y, month: m - 1, day: d }, TZ);
  return mm.isValid() ? mm.startOf("day") : null;
}

/**
 * Decide one slip. `ocr` is extractSlipData()'s result (or null).
 * Returns { autoApproved, reason, account, slipDate, checks }.
 */
async function decideSlip(ocr, expectedAmount) {
  const checks = {};
  if (!ocr) {
    return { autoApproved: false, reason: "Slip could not be read — admin review", account: null, slipDate: null, checks };
  }
  let accounts = [];
  try {
    accounts = await listActive();
  } catch (e) {
    console.error("[slipRules] accounts:", e.message);
  }
  const hit = matchAccount(ocr.rawText, accounts);
  const account = hit
    ? {
        id: hit.account.id,
        title: hit.account.title,
        provider: hit.account.provider,
        last4: digitsOnly(hit.account.number).slice(-4),
        how: hit.how,
      }
    : null;
  checks.account = !!account;

  const date = parseSlipDate(ocr.date);
  const today = moment.tz(TZ).startOf("day");
  const ageDays = date ? today.diff(date, "days") : null;
  checks.date = date != null && ageDays <= MAX_SLIP_AGE_DAYS && ageDays >= -1;
  checks.reference = !!ocr.refNumber;
  const amt = Number(ocr.amount) || 0;
  checks.amount = amt > 0 && amt >= expectedAmount - AMOUNT_TOLERANCE_PKR;

  const problems = [];
  const expected = Number(expectedAmount) || 0;
  if (expected > 0) {
    if (!(amt > 0)) problems.push("Amount not read");
    else if (amt < expected - AMOUNT_TOLERANCE_PKR) problems.push(`Paid Rs ${amt} of Rs ${expected}`);
  }
  if (!checks.account) {
    problems.push(
      ocr.receiver && !ocr.receiverVerified
        ? `Paid to "${ocr.receiver}", not one of our accounts`
        : "None of our payment accounts found on the slip"
    );
  }
  if (!checks.reference) problems.push("No transaction / reference number found");
  if (!date) problems.push("Slip date not found");
  else if (!checks.date) problems.push(`Slip date ${date.format("D MMM YYYY")} is older than ${MAX_SLIP_AGE_DAYS} days`);

  const slipDate = date ? date.format("YYYY-MM-DD") : null;
  if (problems.length) {
    return { autoApproved: false, reason: `${problems.join(" · ")} — admin review`, account, slipDate, checks };
  }
  const paid = amt ? `PKR ${amt}` : "Amount not read";
  return {
    autoApproved: true,
    reason: `Verified: ${paid} to ${account.title} (${account.provider} …${account.last4}) on ${date.format("D MMM YYYY")}, ref ${ocr.refNumber}`,
    account,
    slipDate,
    checks,
  };
}

/**
 * The amount an in-app slip must show, from the server's own prices:
 * this plan + duration's prices (and her live trial-offer price, if any).
 * The price the phone sent is used only if it is one of those; otherwise the
 * lowest real price is expected. null = no price known (amount not checked).
 */
async function expectedPriceFor({ userId, planId, durationId, clientPrice }) {
  const { Price, TrialOffer } = require("../models");
  const where = { planId };
  if (durationId) where.durationId = durationId;
  let allowed = (await Price.findAll({ where, attributes: ["priceAmount"], raw: true }))
    .map((p) => Number(String(p.priceAmount).replace(/[^0-9.]/g, "")))
    .filter((n) => n > 0);
  try {
    const offer = userId ? await TrialOffer.findOne({ where: { userId, redeemedAt: null } }) : null;
    if (offer && new Date(offer.expiresAt) > new Date()) {
      const items = typeof offer.items === "string" ? JSON.parse(offer.items) : offer.items;
      for (const i of items || []) {
        if (Number(i.planId) === Number(planId) && (!durationId || Number(i.durationId) === Number(durationId))) allowed.push(Number(i.offerPrice));
      }
    }
  } catch (_) { /* no offers table: plan prices only */ }
  allowed = allowed.filter((n) => n > 0);
  if (!allowed.length) return null;
  const client = Number(clientPrice);
  return allowed.includes(client) ? client : Math.min(...allowed);
}

module.exports = { decideSlip, parseSlipDate, expectedPriceFor, MAX_SLIP_AGE_DAYS, AMOUNT_TOLERANCE_PKR };
