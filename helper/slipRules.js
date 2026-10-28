// Payment slip rules (Oct 2026). A slip is approved automatically only
// when ALL of these are true; otherwise it waits for the admin with the
// exact reason:
//   1. It shows one of Fit Her's active payment accounts (admin list).
//   2. A transaction / reference number was found (and never used before:
//      checked by the caller).
//   3. The slip date is within the last MAX_SLIP_AGE_DAYS days (PKT).
//   (Oct 2026: the amount is NOT checked any more — discounts and offers
//   make the price vary. It is still read and shown to the admin, and the
//   admin confirms the money arrived within 48 h.)
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
  // Amount: recorded in checks.amount for the admin, never blocks.

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

module.exports = { decideSlip, parseSlipDate, MAX_SLIP_AGE_DAYS, AMOUNT_TOLERANCE_PKR };
