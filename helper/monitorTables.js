// Monitoring tables (Nov 2026) — created on first use, idempotent.
let ready = null;
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS system_errors (
    sig_hash CHAR(40) NOT NULL PRIMARY KEY, signature VARCHAR(255) NOT NULL, sample TEXT NULL,
    process VARCHAR(40) NULL, count INT UNSIGNED NOT NULL DEFAULT 0,
    first_seen DATETIME NOT NULL, last_seen DATETIME NOT NULL, INDEX idx_last_seen (last_seen))`,
  `CREATE TABLE IF NOT EXISTS job_locks (
    name VARCHAR(80) NOT NULL PRIMARY KEY, owner VARCHAR(120) NOT NULL, locked_until DATETIME NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS job_heartbeats (
    name VARCHAR(80) NOT NULL, host VARCHAR(80) NOT NULL, role VARCHAR(20) NOT NULL,
    last_start DATETIME NULL, last_ok DATETIME NULL, last_error VARCHAR(500) NULL, last_error_at DATETIME NULL,
    last_ms INT UNSIGNED NULL, runs INT UNSIGNED NOT NULL DEFAULT 0, fails INT UNSIGNED NOT NULL DEFAULT 0,
    skips INT UNSIGNED NOT NULL DEFAULT 0, updated_at DATETIME NOT NULL, PRIMARY KEY (name, host, role))`,
];
function ensureTables(sequelize) {
  if (!ready) {
    ready = (async () => { for (const st of STATEMENTS) await sequelize.query(st); })()
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}
module.exports = { ensureTables };
