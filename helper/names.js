// Nov 2026: how to call a dietitian in a client's push. Some are saved
// as first name "DR" / "Dr." + last name "Asma": "Dr Asma", never "DR".
function dietitianShortName(u, fallback = "your dietitian") {
  if (!u) return fallback;
  const first = String(u.firstName || "").trim();
  const last = String(u.lastName || "").trim();
  if (/^dr\.?$/i.test(first)) return last ? `Dr ${last.split(/\s+/)[0]}` : fallback;
  if (/^dr\.?\s+/i.test(first)) return `Dr ${first.replace(/^dr\.?\s+/i, "").split(/\s+/)[0]}`;
  return first || fallback;
}
module.exports = { dietitianShortName };
