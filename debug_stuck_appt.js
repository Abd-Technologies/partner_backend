const { Op } = require('sequelize');
const db = require('./models');

(async () => {
  try {
    const rows = await db.Appointment.findAll({
      where: {
        date: {
          [Op.gte]: '2026-09-15',
          [Op.lte]: '2026-09-17',
        },
      },
      order: [['date', 'ASC']],
      raw: true,
    });
    console.log('ROW_COUNT:', rows.length);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e) {
    console.error('ERROR', e);
  } finally {
    await db.sequelize.close();
  }
})();
