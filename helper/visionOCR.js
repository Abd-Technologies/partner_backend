/**
 * visionOCR.js — Google Cloud Vision API integration for payment slip OCR.
 *
 * Uses API key auth (GOOGLE_VISION_API_KEY in .env) — no service account
 * needed, sidesteps the org policy that blocks service account keys.
 *
 * Usage:
 *   const { extractSlipData } = require('../helper/visionOCR');
 *   const result = await extractSlipData('/path/to/slip.jpg');
 *   // → { rawText, amount, date, bank, sender, confidence, raw }
 *
 * Returns null if extraction fails completely (network error, invalid key).
 */

const fs = require('fs/promises');

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';

// Known Pakistani banks + wallets (canonical name → match patterns)
const BANK_PATTERNS = [
  { name: 'HBL',                patterns: [/\bHBL\b/i, /Habib Bank/i, /Habib\s*Bank\s*Limited/i] },
  { name: 'MCB',                patterns: [/\bMCB\b/i, /Muslim Commercial/i] },
  { name: 'Allied Bank',        patterns: [/\bABL\b/i, /Allied Bank/i] },
  { name: 'Meezan Bank',        patterns: [/Meezan/i] },
  { name: 'JS Bank',            patterns: [/\bJS Bank\b/i] },
  { name: 'UBL',                patterns: [/\bUBL\b/i, /United Bank/i] },
  { name: 'Faysal Bank',        patterns: [/Faysal/i] },
  { name: 'Bank Alfalah',       patterns: [/Bank\s*Al\s*Falah/i, /Alfalah/i] },
  { name: 'Standard Chartered', patterns: [/Standard Chartered/i, /\bSCB\b/i] },
  { name: 'JazzCash',           patterns: [/Jazz\s*Cash/i] },
  { name: 'EasyPaisa',          patterns: [/Easy\s*Paisa/i] },
  { name: 'NayaPay',            patterns: [/Naya\s*Pay/i] },
  { name: 'SadaPay',            patterns: [/Sada\s*Pay/i] },
  { name: 'Askari Bank',        patterns: [/Askari/i, /\bAKBL\b/i] },
  { name: 'Bank Al Habib',      patterns: [/Bank Al Habib/i, /\bBAHL\b/i] },
  { name: 'Soneri Bank',        patterns: [/Soneri/i] },
  { name: 'Summit Bank',        patterns: [/Summit Bank/i] },
];

// Amount extraction — captures Pakistani formats with currency markers
// IMPORTANT: regex with /g flag is stateful — we reset .lastIndex inside parseSlipText
const AMOUNT_PATTERNS = [
  // "Rs. 5,000.00" or "Rs 5,000" or "PKR 5,000" — allows space OR no space
  /(?:Rs\.?|PKR|₨|Rupees?)\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi,
  // "Amount Rs. 5000" or "Total: 5,000" or "Paid Amount 3000" — keyword anywhere before number
  /(?:Amount|Amt\.?|Total|Paid|Transfer(?:red)?|Trans(?:fer)?\s*Amount|Sent)\s*[:.]?\s*(?:Rs\.?|PKR|₨)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/gi,
  // "5,000.00 PKR" or "5000/-" or "3000.00/-"
  /([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:\/-|PKR|Rs\.?|₨)/gi,
  // Bare 3-7 digit number standalone (last resort — Askari sometimes just prints "3000")
  // Only matches if surrounded by whitespace/start/end, not part of date or other number
  /(?:^|\s|:|,)([0-9]{3,7})(?=\s|$|\.|,)/gm,
];

// Date extraction — captures common Pakistani slip date formats
const DATE_PATTERNS = [
  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g,
  // "12 May 2026" or "12-May-2026"
  /\b(\d{1,2})[\s\-]+([A-Za-z]+)[\s\-]+(\d{2,4})\b/g,
  // ISO 8601 "2026-05-12"
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
];

// Parse a raw text into structured data.
// Exported for testability; called automatically by extractSlipData.
function parseSlipText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { amount: null, amounts: [], date: null, bank: null, sender: null, refNumber: null };
  }

  // Normalize whitespace
  const text = rawText.replace(/\r\n/g, '\n');

  // Amount — collect ALL candidate amounts, pick the largest (usually the main transfer amount).
  // Reset .lastIndex on each regex because /g flag persists state across calls
  // (these regexes are module-level constants).
  const amounts = [];
  for (const re of AMOUNT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const numStr = m[1].replace(/[,\s]/g, '');
      const num = parseFloat(numStr);
      // Filter: reasonable transfer amount range, exclude tiny numbers (often fees/balances)
      if (!isNaN(num) && num >= 100 && num < 10_000_000) {
        amounts.push(num);
      }
    }
  }
  // Dedupe and sort descending — largest is usually the transfer amount
  const uniqAmounts = [...new Set(amounts)].sort((a, b) => b - a);
  const amount = uniqAmounts[0] || null;

  // Date — first valid date found
  let date = null;
  for (const re of DATE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      date = m[0];
      break;
    }
  }

  // Bank — first match wins (most slips name the bank prominently)
  let bank = null;
  for (const bp of BANK_PATTERNS) {
    if (bp.patterns.some(re => re.test(text))) {
      bank = bp.name;
      break;
    }
  }

  // Sender name — look for patterns like "From: NAME" or "Sender: NAME"
  let sender = null;
  const senderMatch = /(?:From|Sender|Sent\s*by|Payer)\s*[:.]?\s*([A-Z][A-Z\s.'-]{2,40}[A-Z])/m.exec(text);
  if (senderMatch) sender = senderMatch[1].trim();

  // Reference / transaction ID — REQUIRE a colon/space separator so we don't
  // accidentally capture the tail of the keyword itself (e.g., "Reference" → "erence").
  // Capture must start with a letter or digit, and be 7+ chars (real ref numbers are
  // never 6 chars or "erence"-like word fragments).
  let refNumber = null;
  const refPatterns = [
    // "Reference: ABC1234" / "Reference #ABC1234" / "Ref. No. ABC1234"
    /(?:Reference|Ref(?:erence)?\s*(?:No|Number|#)|Transaction\s*ID|Transaction\s*Number|Trans(?:action)?\s*Ref(?:erence)?|Trx(?:n)?\s*ID|TID)\s*[#:]\s*([A-Z0-9][A-Z0-9\-]{6,31})/i,
    // "Ref. ABC1234" or "Ref ABC1234" — space-only separator allowed but only with Ref. abbreviation
    /\bRef\.?\s+([A-Z0-9][A-Z0-9\-]{6,31})\b/i,
    // Generic "ID: XYZ" if it's a long alphanumeric
    /\b(?:ID|TID)\s*[#:]\s*([A-Z0-9][A-Z0-9\-]{7,31})\b/i,
  ];
  for (const re of refPatterns) {
    const m = re.exec(text);
    if (m && m[1]) {
      // Reject obvious false positives like "erence" or partial keywords
      const candidate = m[1].toUpperCase();
      if (!/^(REFERENCE|TRANSACTION|NUMBER|ERENCE)/i.test(candidate)) {
        refNumber = m[1];
        break;
      }
    }
  }

  return {
    amount,
    amounts: uniqAmounts,
    date,
    bank,
    sender,
    refNumber,
  };
}

/**
 * Score how confident we are that this slip is legitimate and matches expectations.
 * Returns a number from 0.0 to 1.0.
 *
 * @param {object} extracted  — output of parseSlipText
 * @param {object} [expected] — { amount, dateMaxAgeDays } — optional, for matching
 */
function scoreSlip(extracted, expected = {}) {
  let score = 0;

  // Bank recognized = +0.3
  if (extracted.bank) score += 0.3;

  // Amount detected = +0.2
  if (extracted.amount) score += 0.2;

  // Date detected = +0.15
  if (extracted.date) score += 0.15;

  // Reference number detected = +0.1
  if (extracted.refNumber) score += 0.1;

  // Sender detected = +0.1
  if (extracted.sender) score += 0.1;

  // Amount matches expected (within ±50 PKR tolerance) = +0.15
  if (expected.amount && extracted.amount) {
    const diff = Math.abs(extracted.amount - expected.amount);
    if (diff <= 50) score += 0.15;
    else if (diff <= 500) score += 0.05;
  }

  return Math.min(1, score);
}

/**
 * Extract structured data from a payment slip image using Cloud Vision.
 *
 * @param {string} imagePath — absolute or relative file path
 * @param {object} [expected] — optional { amount, dateMaxAgeDays } for confidence scoring
 * @returns {Promise<object|null>}
 *   { rawText, amount, date, bank, sender, refNumber, amounts, confidence, raw }
 *   Returns null on hard failure (network, missing key).
 */
async function extractSlipData(imagePath, expected = {}) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    console.warn('⚠️  GOOGLE_VISION_API_KEY not set — OCR skipped');
    return null;
  }

  try {
    const imageBuffer = await fs.readFile(imagePath);
    const base64 = imageBuffer.toString('base64');

    const body = {
      requests: [{
        image: { content: base64 },
        features: [{ type: 'TEXT_DETECTION', maxResults: 1 }],
      }],
    };

    const resp = await fetch(`${VISION_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Vision API error:', resp.status, errText.slice(0, 300));
      return null;
    }

    const json = await resp.json();
    const annotation = json?.responses?.[0]?.fullTextAnnotation
                    || json?.responses?.[0]?.textAnnotations?.[0];
    const rawText = annotation?.text || '';

    const parsed = parseSlipText(rawText);
    const confidence = scoreSlip(parsed, expected);

    return {
      rawText: rawText.slice(0, 2000), // truncate for storage
      amount: parsed.amount,
      amounts: parsed.amounts,
      date: parsed.date,
      bank: parsed.bank,
      sender: parsed.sender,
      refNumber: parsed.refNumber,
      confidence,
      raw: json, // full response for audit; consider stripping if storage is a concern
    };
  } catch (err) {
    console.error('extractSlipData error:', err.message);
    return null;
  }
}

module.exports = {
  extractSlipData,
  parseSlipText,
  scoreSlip,
  BANK_PATTERNS,
};
