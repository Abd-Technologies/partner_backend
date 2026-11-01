// Meet links (Nov 2026).
//
// Each dietitian has her own Meet link, saved on her time slots. Every
// booking keeps a copy of the slot's link from the moment it was booked
// (Appointment.meetLink), so changing a link later used to leave the
// clients who had ALREADY booked with the old one. This copies a new link
// onto the upcoming bookings of those slots.

const { Op } = require("sequelize");

async function syncUpcomingLinks(slotIds, link) {
  const ids = (slotIds || []).filter((x) => x != null);
  if (!ids.length) return 0;
  const { Appointment } = require("../models");
  const [n] = await Appointment.update(
    { meetLink: link || null },
    {
      where: {
        timeSlotId: { [Op.in]: ids },
        status: { [Op.in]: ["pending", "confirmed"] },
        date: { [Op.gte]: new Date(Date.now() - 2 * 86400000) },
      },
    }
  );
  return n;
}

module.exports = { syncUpcomingLinks };
