/**
 * crmLink.js — link an app user to the CRM lead she came from (Nov 2026).
 *
 * Rules:
 *   • Only from links a signed-in rep created (magic payment link, trial
 *     link). The crmLeadId always comes from OUR record of that link, never
 *     from what the phone/browser sends.
 *   • First link wins. A user already linked to another lead is never moved
 *     (logged as a conflict for a human to check).
 *   • Call it BEFORE creating the purchase / trial, inside the same
 *     transaction, so those events already carry crm_lead_id and the CRM
 *     books them on the right lead.
 * Queues an identity_linked event so the CRM links the two at once.
 */
async function linkUserToLead(userId, crmLeadId, source, { transaction } = {}) {
  const leadId = parseInt(crmLeadId, 10);
  const uid = parseInt(userId, 10);
  if (!uid || !leadId) return false;
  try {
    const { CrmLink } = require("../models");
    const existing = await CrmLink.findOne({ where: { userId: uid }, transaction });
    if (existing) {
      if (existing.crmLeadId !== leadId) {
        console.warn(`[crm-link] conflict: user ${uid} is lead ${existing.crmLeadId}, ${source} says ${leadId} — kept ${existing.crmLeadId}`);
      }
      return false;
    }
    await CrmLink.create({ userId: uid, crmLeadId: leadId, source }, { transaction });
    await require("./crmEvents").emit("identity_linked", uid, { link_source: source }, {
      transaction,
      key: `link-${uid}`,
    });
    return true;
  } catch (err) {
    if (err && err.name === "SequelizeUniqueConstraintError") return false; // linked by a parallel request
    console.error("[crm-link] link failed:", err.message);
    return false;
  }
}

async function crmLeadIdFor(userId, { transaction } = {}) {
  try {
    const { CrmLink } = require("../models");
    const row = await CrmLink.findOne({ where: { userId }, attributes: ["crmLeadId"], transaction });
    return row ? row.crmLeadId : null;
  } catch (_) {
    return null;
  }
}

/**
 * backfillFromMagicLinks — one-off, safe to run on every start: links users
 * who already paid through a rep's magic link before this existed. No
 * events are sent for these (the CRM backfill covers them).
 */
async function backfillFromMagicLinks() {
  const { sequelize } = require("../models");
  const [res] = await sequelize.query(
    "INSERT IGNORE INTO `CrmLinks` (userId, crmLeadId, source, createdAt, updatedAt) " +
      "SELECT m.UserId, m.crmLeadId, 'backfill', NOW(), NOW() FROM `MagicPaymentLinks` m " +
      "WHERE m.UserId IS NOT NULL AND m.crmLeadId IS NOT NULL ORDER BY m.updatedAt DESC"
  );
  return res && res.affectedRows ? res.affectedRows : 0;
}

module.exports = { linkUserToLead, crmLeadIdFor, backfillFromMagicLinks };
