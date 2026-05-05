const crypto = require("crypto");
const validator = require("validator");

const BASE_URL = "https://payin-pwa.directpay.pro/pay";

/* ---------------- VALIDATION ---------------- */

exports.validateDirectPayRequest = (body) => {
  const {
    planId,
    amount,
    payerName,
    email,
    msisdn,
    successRedirectUrl,
    failedRedirectUrl
  } = body;

  if (!planId) return "planId is required";
  if (!amount || isNaN(amount)) return "Invalid amount";
  if (!payerName) return "payerName is required";
  if (!email || !validator.isEmail(email)) return "Invalid email";
  if (!/^03\d{9}$/.test(msisdn)) return "Invalid msisdn";
  if (!successRedirectUrl) return "successRedirectUrl required";
  if (!failedRedirectUrl) return "failedRedirectUrl required";

  const paisas = Math.round(Number(amount) * 100);
  if (paisas < 1000 || paisas > 5000000) {
    return "Amount must be between 10 and 50,000 PKR";
  }

  return null;
};

/* ---------------- HELPERS ---------------- */

exports.toPaisas = (amount) =>
  Math.round(Number(amount) * 100).toString();

exports.generateTransactionId = (planId, userId) => {
  let txId = `FITHER-${planId}-${userId}-${Date.now()}`;
  return txId.length > 50 ? txId.substring(0, 50) : txId;
};

exports.generateChecksum = (txId, description, amountPaisas) => {
  const plainText = `DirectPay:${txId}:${description}:${amountPaisas}`;
  return crypto
    .createHmac("sha256", process.env.DIRECTPAY_CLIENT_SECRET)
    .update(plainText)
    .digest("hex");
};


exports.buildPayinUrl = ({
  clientTransactionId,
  amountPaisas,
  description,
  payerName,
  email,
  msisdn,
  checksum,
  successRedirectUrl,
  failedRedirectUrl
}) => {
  return (
    `${BASE_URL}?` +
    `client_id=${process.env.DIRECTPAY_CLIENT_ID}` +
    `&client_transaction_id=${clientTransactionId}` +
    `&amount=${amountPaisas}` +
    `&description=${encodeURIComponent(description)}` + // 🔥 FIX
    `&payer_name=${encodeURIComponent(payerName)}` +
    `&email=${encodeURIComponent(email)}` +
    `&msisdn=${msisdn}` +
    `&checksum=${checksum}` +
    `&currency=PKR` +
    `&success_redirect_url=${encodeURIComponent(successRedirectUrl)}` +
    `&failed_redirect_url=${encodeURIComponent(failedRedirectUrl)}`
  );
};

