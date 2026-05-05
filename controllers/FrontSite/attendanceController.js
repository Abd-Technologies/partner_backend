// const { Op } = require("sequelize");
// const { ClassAttendance } = require("../../models");

// exports.getMotivationStats = async (req, res) => {
//     try {
//       const userId = req.params.userId; // Get from params
  
//       // Fetch all attendance for last 30 days
//       const attendances = await ClassAttendance.findAll({
//         where: {
//           user_id: userId,
//           attended_at: {
//             [Op.gte]: new Date(new Date().setDate(new Date().getDate() - 29)) // last 30 days
//           }
//         },
//         attributes: ["attended_at"],
//         group: ["attended_at"],
//         order: [["attended_at", "ASC"]]
//       });
  
//       const dates = attendances.map(a => new Date(a.attended_at));
//       dates.sort((a, b) => b - a);
  
//       // ---------- Calculate Streak ----------
//       let streak = 0;
//       let currentDate = new Date();
//       currentDate.setHours(0, 0, 0, 0);
  
//       for (let date of dates) {
//         date.setHours(0, 0, 0, 0);
//         if (date.getTime() === currentDate.getTime()) {
//           streak++;
//           currentDate.setDate(currentDate.getDate() - 1);
//         } else {
//           break;
//         }
//       }
  
//       // ---------- Attendance Counts ----------
//       const daysAttendedLast7 = dates.filter(d => {
//         const diffDays = (new Date() - d) / (1000 * 60 * 60 * 24);
//         return diffDays < 7;
//       }).length;
  
//       const daysAttendedLast30 = dates.length;
//       const regularityPercentage = (daysAttendedLast30 / 30) * 100;
  
//       // ---------- Chart Data for Frontend ----------
//       const last30DaysData = [];
//       let today = new Date();
//       today.setHours(0, 0, 0, 0);
  
//       for (let i = 29; i >= 0; i--) {
//         const date = new Date(today);
//         date.setDate(today.getDate() - i);
//         const dateStr = date.toISOString().split("T")[0];
//         const attended = dates.some(d => d.toISOString().split("T")[0] === dateStr);
  
//         last30DaysData.push({
//           date: dateStr,
//           attended: attended ? 1 : 0
//         });
//       }
  
//       res.json({
//         streak,
//         daysAttendedLast7,
//         daysAttendedLast30,
//         regularityPercentage: Math.round(regularityPercentage),
//         attendanceHistory: last30DaysData
//       });
  
//     } catch (err) {
//       res.status(500).json({ message: err.message });
//     }
//   };
  



//   exports.markAttendance = async (req, res) => {
//     try {
//       const userId = req.params.userId; // or req.user.id if using auth
//       const { slotId } = req.body;      // Get slotId from request body
//       const today = new Date().toISOString().split("T")[0];
  
//       // Check if attendance already exists for today for this user and slot (if slotId is provided)
//       const alreadyMarked = await ClassAttendance.findOne({
//         where: {
//           user_id: userId,
//           attended_at: today,
//         }
//       });
  
//       if (alreadyMarked) {
//         return res.status(400).json({ message: "Attendance already marked for today for this slot" });
//       }
  
//       // Mark attendance
//       await ClassAttendance.create({
//         user_id: userId,
//         slot_id: slotId || null, // store null if no slotId provided
//         attended_at: today,
//         createdAt: new Date(),
//         updatedAt: new Date()
//       });
  
//       res.json({ message: "Attendance marked successfully" });
//     } catch (err) {
//       res.status(500).json({ message: err.message });
//     }
//   };
  
const { Op } = require("sequelize");
const { ClassAttendance } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");

// Get Motivation Stats
exports.getMotivationStats = async (req, res) => {
  try {
    const userId = req.params.userId;

    // Fetch all attendance for last 30 days
    const attendances = await ClassAttendance.findAll({
      where: {
        user_id: userId,
        attended_at: {
          [Op.gte]: new Date(new Date().setDate(new Date().getDate() - 29))
        }
      },
      attributes: ["attended_at"],
      group: ["attended_at"],
      order: [["attended_at", "ASC"]]
    });

    const dates = attendances.map(a => new Date(a.attended_at));
    dates.sort((a, b) => b - a);

    // ---------- Calculate Streak ----------
    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (let date of dates) {
      date.setHours(0, 0, 0, 0);
      if (date.getTime() === currentDate.getTime()) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }

    // ---------- Attendance Counts ----------
    const daysAttendedLast7 = dates.filter(d => {
      const diffDays = (new Date() - d) / (1000 * 60 * 60 * 24);
      return diffDays < 7;
    }).length;

    const daysAttendedLast30 = dates.length;
    const regularityPercentage = (daysAttendedLast30 / 30) * 100;

    // ---------- Chart Data ----------
    const last30DaysData = [];
    let today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      const attended = dates.some(d => d.toISOString().split("T")[0] === dateStr);

      last30DaysData.push({
        date: dateStr,
        attended: attended ? 1 : 0
      });
    }

    const response = ApiResponse("1", "Motivation stats fetched successfully", {
      streak,
      daysAttendedLast7,
      daysAttendedLast30,
      regularityPercentage: Math.round(regularityPercentage),
      attendanceHistory: last30DaysData
    });
    return res.json(response);

  } catch (err) {
    const response = ApiResponse("0", err.message, {});
    return res.json(response);
  }
};

// Mark Attendance
exports.markAttendance = async (req, res) => {
  try {
    const userId = req.params.userId;
    const { slotId } = req.body;
    const today = new Date().toISOString().split("T")[0];

    // Prevent multiple marks on same date (regardless of slot)
    const alreadyMarked = await ClassAttendance.findOne({
      where: {
        user_id: userId,
        attended_at: today
      }
    });

    if (alreadyMarked) {
      const response = ApiResponse("0", "Attendance already marked for today", {});
      return res.json(response);
    }

    await ClassAttendance.create({
      user_id: userId,
      slot_id: slotId || null,
      attended_at: today,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const response = ApiResponse("1", "Attendance marked successfully", {});
    return res.json(response);

  } catch (err) {
    const response = ApiResponse("0", err.message, {});
    return res.json(response);
  }
};
