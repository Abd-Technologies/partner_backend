// Shows why the last uploaded slips were / weren't auto-approved.
// Run from the backend folder:  node scripts/lastSlip.js   (or: node scripts/lastSlip.js 5)
const db = require("../models");

(async () => {
  const n = parseInt(process.argv[2], 10) || 3;
  const rows = await db.PlanImage.findAll({ order: [["id", "DESC"]], limit: n });
  for (const r of rows) {
    const d = typeof r.ocrData === "string" ? JSON.parse(r.ocrData || "{}") : r.ocrData || {};
    console.log(`\n#${r.id}  ${r.createdAt.toISOString()}  user ${r.UserId}  price ${r.price}  status ${r.status}  verify ${r.verifyStatus}`);
    console.log(`  read: amount ${r.ocrAmount}  date ${r.ocrDate}  ref ${r.ocrTransactionId}  bank ${r.ocrBank}`);
    console.log(`  checks: ${JSON.stringify(d.checks || null)}`);
    console.log(`  result: ${d.autoApproved ? "AUTO-APPROVED" : "admin review"} — ${d.approvalReason || "(no OCR data)"}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
