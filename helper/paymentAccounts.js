// Fit Her payment accounts: list, first-run seed, and "which of our
// accounts is on this slip?".
const DEFAULTS = [
  { kind: "wallet", provider: "JazzCash / EasyPaisa", title: "Shaista Khalid", number: "03055124674", sortOrder: 1 },
  { kind: "wallet", provider: "JazzCash", title: "Fit Her", number: "03235135417", sortOrder: 2 },
  {
    kind: "bank",
    provider: "Soneri Bank",
    title: "Fit Her (Private) Limited",
    number: "120014636405",
    iban: "PK60SONE0000120014636405",
    swift: "SONEPKKA",
    branch: "Mall Road Branch, Lahore (Branch Code 0001) · 87 Shahrah-e-Quaid-e-Azam, Mall Road, Lahore",
    note: "Current Deposit Account",
    sortOrder: 3,
  },
];

const M = () => require("../models");

/** First start only: the table is empty → add the three accounts. */
async function ensureSeed() {
  const { PaymentAccount } = M();
  if ((await PaymentAccount.count()) > 0) return false;
  await PaymentAccount.bulkCreate(DEFAULTS);
  return true;
}

async function listActive() {
  const { PaymentAccount } = M();
  return PaymentAccount.findAll({ where: { active: true }, order: [["sortOrder", "ASC"], ["id", "ASC"]] });
}

const digitsOnly = (s) => String(s || "").replace(/\D/g, "");

/** Words of the account title that must appear on the slip ("fither", "shaistakhalid"). */
function titleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\(?\s*(private|pvt\.?)\s*\)?/g, "")
    .replace(/\b(limited|ltd\.?)\b/g, "")
    .replace(/[^a-z]/g, "");
}

/** Number forms a slip may show: 03055124674 / 3055124674 / 923055124674. */
function numberForms(acc) {
  const n = digitsOnly(acc.number);
  const forms = new Set([n]);
  if (acc.kind === "wallet" && n.startsWith("0")) {
    forms.add(n.slice(1));
    forms.add("92" + n.slice(1));
  }
  if (acc.iban) forms.add(String(acc.iban).toUpperCase().replace(/\s/g, ""));
  return [...forms].filter((f) => f.length >= 6);
}

/**
 * Which active account is on this slip text? Returns
 * { account, how: 'number' | 'masked+title' } or null.
 *   number        the full number / IBAN is on the slip
 *   masked+title  last 4 digits (slips often hide the rest: 0323****5417)
 *                 AND the account title are both on the slip
 */
function matchAccount(rawText, accounts) {
  if (!rawText) return null;
  const upper = String(rawText).toUpperCase();
  const compact = upper.replace(/[\s\-]/g, "");
  const lettersOnly = String(rawText).toLowerCase().replace(/[^a-z]/g, "");
  for (const acc of accounts) {
    for (const f of numberForms(acc)) {
      if (/^[0-9]+$/.test(f) ? compact.includes(f) : compact.includes(f)) {
        return { account: acc, how: "number" };
      }
    }
  }
  for (const acc of accounts) {
    const n = digitsOnly(acc.number);
    const last4 = n.slice(-4);
    const key = titleKey(acc.title);
    if (!last4 || !key) continue;
    const last4Shown = new RegExp(`(?:[*xX•.]{2,}\\s*-?\\s*|\\D)${last4}(?!\\d)`).test(upper);
    if (last4Shown && lettersOnly.includes(key)) return { account: acc, how: "masked+title" };
  }
  return null;
}

module.exports = { DEFAULTS, ensureSeed, listActive, matchAccount, titleKey, digitsOnly };
