'use strict';
// Login security (Oct 2026):
//   Users.tokenVersion  +1 on logout / password change -> old tokens stop working
//   OtpData.otpTries    wrong reset-code tries (5 cancel the code)
// Idempotent — safe on every start (app.js runs it after sync()).
function hasColumn(desc, name) {
  return Object.keys(desc).some((k) => k.toLowerCase() === name.toLowerCase());
}

async function otpTable(queryInterface, db) {
  const names = [];
  try {
    if (db && db.OtpData && db.OtpData.getTableName) {
      const t = db.OtpData.getTableName();
      names.push(typeof t === 'string' ? t : t.tableName);
    }
  } catch (_) {}
  names.push('OtpData', 'OtpDatas', 'otpdata');
  for (const n of names) {
    try {
      const desc = await queryInterface.describeTable(n);
      return { name: n, desc };
    } catch (_) {}
  }
  return null;
}

module.exports = {
  async up(queryInterface, Sequelize, db) {
    const users = await queryInterface.describeTable('Users');
    if (!hasColumn(users, 'tokenVersion')) {
      await queryInterface.addColumn('Users', 'tokenVersion', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    }
    const otp = await otpTable(queryInterface, db);
    if (otp && !hasColumn(otp.desc, 'otpTries')) {
      await queryInterface.addColumn(otp.name, 'otpTries', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    }
  },
  async down(queryInterface, Sequelize, db) {
    const users = await queryInterface.describeTable('Users');
    if (hasColumn(users, 'tokenVersion')) await queryInterface.removeColumn('Users', 'tokenVersion');
    const otp = await otpTable(queryInterface, db);
    if (otp && hasColumn(otp.desc, 'otpTries')) await queryInterface.removeColumn(otp.name, 'otpTries');
  },
};
