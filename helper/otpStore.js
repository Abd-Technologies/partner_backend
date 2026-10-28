// Password-reset codes (Oct 2026 security pass). One OtpData row per email.
//   • a code works for 10 minutes
//   • 5 wrong tries cancel the code ("Too many tries. Please ask for a new code.")
//   • a new code can be asked for at most 3 times per 15 minutes per email
// Codes stay 4 digits for now (old app screens have 4 boxes).
const crypto = require("crypto");
const { hit } = require("./rateLimit");

const MIN = 60 * 1000;
const OTP_TTL_MS = 10 * MIN;
const MAX_TRIES = 5;
const REQUESTS_PER_WINDOW = 3;
const REQUEST_WINDOW_MS = 15 * MIN;
const GENERIC_SENT = "If this email has an account, we sent a code.";
const TOO_MANY_TRIES = "Too many tries. Please ask for a new code.";
const TOO_MANY_REQUESTS = "Too many codes asked for. Please wait 15 minutes and try again.";

const models = () => require("../models");
const normEmail = (e) => String(e || "").trim().toLowerCase();
const generateOTP = () => crypto.randomInt(1000, 10000).toString();

/** May this email ask for a new code now? (counts the request) */
function requestAllowed(email) {
  return hit(`otp-request:${normEmail(email)}`, REQUESTS_PER_WINDOW, REQUEST_WINDOW_MS).ok;
}

/** New code for this email (replaces any old one). Returns the code. */
async function issue(email) {
  const { OtpData } = models();
  const e = normEmail(email);
  const otp = generateOTP();
  let row = await OtpData.findOne({ where: { email: e } });
  if (!row) row = OtpData.build({ email: e });
  row.otp = otp;
  row.requestAt = new Date();
  row.status = true;
  row.otpTries = 0;
  await row.save();
  return otp;
}

/**
 * Check a code. Wrong codes count; the 5th wrong one cancels the code.
 * Returns { ok: true, record } or { ok: false, message }.
 */
async function check(email, otp, now = Date.now()) {
  const { OtpData } = models();
  const e = normEmail(email);
  const code = String(otp == null ? "" : otp).trim();
  const row = await OtpData.findOne({ where: { email: e } });
  if (!row) return { ok: false, message: "No password reset was requested for this email." };
  if (!row.requestAt || new Date(row.requestAt).getTime() < now - OTP_TTL_MS) {
    return { ok: false, message: "OTP has expired. Please request a new one." };
  }
  if (!row.status) {
    return {
      ok: false,
      message: (Number(row.otpTries) || 0) >= MAX_TRIES ? TOO_MANY_TRIES : "OTP has already been used. Please request a new one.",
    };
  }
  if (!code || String(row.otp).trim() !== code) {
    row.otpTries = (Number(row.otpTries) || 0) + 1;
    if (row.otpTries >= MAX_TRIES) {
      row.status = false; // cancelled
      await row.save();
      return { ok: false, message: TOO_MANY_TRIES };
    }
    await row.save();
    return { ok: false, message: "Invalid OTP. Please check the code sent to your email." };
  }
  return { ok: true, record: row };
}

/** After the password is changed: the code can't be used again. */
async function consume(row) {
  if (!row) return;
  row.status = false;
  await row.save();
}

module.exports = {
  requestAllowed,
  issue,
  check,
  consume,
  generateOTP,
  normEmail,
  GENERIC_SENT,
  TOO_MANY_TRIES,
  TOO_MANY_REQUESTS,
  OTP_TTL_MS,
  MAX_TRIES,
};
