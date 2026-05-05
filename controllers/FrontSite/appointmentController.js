
const { Appointment, User, SlotDiet, AppointmentReview } = require("../../models");
const ApiResponse = require("../../helper/ApiResponse");
const sendNotification = require("../../helper/notification");
const { findFrozenActivePlan } = require("../../helper/freezeGate");
const { Op } = require("sequelize");


// Get all appointments for a specific dietitian
exports.getAllAppointments = async (req, res) => {
  try {
    const { id } = req.params;
    const appointments = await Appointment.findAll({
      where: { dietitionId: id },
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          as: "ClientUser",
        },
        {
          model: SlotDiet,
          attributes: { exclude: ["createdAt", "updatedAt"] },
        },
      ],
    });
    const response = ApiResponse("1", "Appointments fetched successfully", { appointments });
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching appointments: ${error.message}`, {});
    return res.status(500).json(response);
  }
};

exports.getAllAppointmentStatus = async (req, res) => {
  try {
    const appointments = await Appointment.findAll({
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          as: "ClientUser",
        },
        {
          model: SlotDiet,
          attributes: { exclude: ["createdAt", "updatedAt"] },
        },
      ],
    });
    const response = ApiResponse("1", "Appointments fetched successfully", { appointments });
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching appointments: ${error.message}`, {});
    return res.status(500).json(response);
  }
};

// Get a specific appointment by ID
exports.getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;
    const appointment = await Appointment.findByPk(id, {
      include: [
        { model: User, as: "ClientUser" },
        { model: SlotDiet },
      ],
    });
    if (!appointment) {
      const response = ApiResponse("0", "Appointment not found", {});
      return res.status(404).json(response);
    }
    const response = ApiResponse("1", "Appointment fetched successfully", appointment);
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching appointment: ${error.message}`, {});
    return res.status(500).json(response);
  }
};

// Create a new appointment
exports.createAppointment = async (req, res) => {
  const { date, userId, dietitionId, timeSlotId, userPlanId, kind } = req.body;
  if (!date || !userId || !dietitionId || !timeSlotId || !userPlanId) {
    const response = ApiResponse("0", "Invalid input data", {});
    return res.status(200).json(response);
  }
  // Consultation-flow extension (Phase 1A): if the client supplies `kind`
  // ("initial" | "followup") we persist it. Legacy callers omit it and
  // the column stays NULL — backward compatible.
  const VALID_KINDS = new Set(["initial", "followup"]);
  const persistedKind =
    typeof kind === "string" && VALID_KINDS.has(kind) ? kind : null;

  // Freeze gate — block consultation booking while the user's plan is
  // paused. Resume from profile to book again. See helper/freezeGate.js.
  const frozenPlan = await findFrozenActivePlan(userId);
  if (frozenPlan) {
    return res.json(
      ApiResponse(
        "0",
        "Your plan is paused. Resume it from your profile to book a consultation.",
        { isFrozen: true, frozenAt: frozenPlan.frozenAt }
      )
    );
  }

  try {
// "Already booked" means another live appointment exists for the SAME
// slot template AND the SAME calendar date. SlotDiet rows are weekday
// templates, so without the date filter every successful booking would
// permanently consume the slot for all future dates.
//
// The status list also matters: prior code wrote "complete" (a value
// that doesn't exist in the enum), which silently freed slots for
// re-booking the moment a session finished. The enum value is
// "completed".
const existingAppointment = await Appointment.findOne({
  where: {
    timeSlotId,
    date,
    status: {
      [Op.in]: ["pending", "confirmed", "In Progress", "completed"]
    }
  }
});
// Reschedule signal is per-user — "did THIS user previously cancel
// THIS slot on THIS date and is now rebooking?". The prior version
// queried by timeSlotId only, which marked every fresh booking as a
// reschedule whenever any user had ever canceled that template.
const appointmentCancelByUser = await Appointment.findOne({
  where: {
    timeSlotId,
    date,
    userId,
    status: 'canceledByUser'
  }
});

    if (existingAppointment) {
      const response = ApiResponse("0", "Time slot already booked", {});
      return res.status(200).json(response);
    }

    const newAppointment = await Appointment.create({
      date,
      userId,
      dietitionId,
      timeSlotId,
      status: "pending",
      planId: userPlanId,
      reschedule: !!appointmentCancelByUser,
      kind: persistedKind,
    });

    const user = await User.findByPk(userId);
    const dietitian = await User.findByPk(dietitionId);

    const notify = async (deviceToken, title, body) => {
      if (deviceToken) {
        try {
          await sendNotification([deviceToken], { title, body });
        } catch (err) {
          console.error("Notification error:", err.message);
        }
      }
    };

    await Promise.all([
      notify(user?.deviceToken, "Booking Pending", `Your booking has been sent to ${dietitian?.firstName} ${dietitian?.lastName}. Please wait for confirmation`),
      notify(dietitian?.deviceToken, "Booking Added", `Your booking has been added with ${user?.firstName} ${user?.lastName}`)
    ]);

    const response = ApiResponse("1", "Appointment created successfully", { appointment: newAppointment });
    return res.status(200).json(response);
  } catch (error) {
    console.error("Create error:", error);
    const response = ApiResponse("0", "Error creating appointment", { error: error.message });
    return res.status(500).json(response);
  }
};

// Update an appointment
exports.updateAppointment = async (req, res) => {
  const { id } = req.params;
  const { status, reschedule, actorUserId } = req.body;

  console.log("Update status:", req.body);

  try {
    const appointment = await Appointment.findOne({ where: { id } });

    if (!appointment) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }

    const statusChanged = status != null && status !== appointment.status;

    if (status != null) {
      appointment.status = status;
    }

    if (reschedule != null) {
      appointment.reschedule = reschedule;
    }

    // Audit signal — mirrors Slot.completed_by. Manual endpoint MUST set
    // completed_by; NULL is reserved for the auto-end cron. actorUserId
    // is whichever side flipped the status (dietitian for confirm/cancel/
    // complete, user for canceledByUser).
    if (statusChanged) {
      appointment.completed_by = actorUserId != null ? actorUserId : appointment.dietitionId;
      appointment.status_changed_at = new Date();
    }

    await appointment.save();

    const user = await User.findByPk(appointment.userId);

    // Send notification if status was changed
    if (status != null && user?.deviceToken) {
      if (status === "canceled") {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Appointment Canceled",
            body: "Your appointment has been canceled by your dietitian. You can reschedule it at your convenience."
          }
        );
      } else if (status === "confirmed") {
        await sendNotification(
          [user.deviceToken],
          {
            title: "Appointment Confirmed",
            body: "Your appointment has been confirmed by your dietitian. Please be on time. Thank you!"
          }
        );
      }
    }

    return res.status(200).json(ApiResponse("1", "Appointment updated successfully", { appointment }));
  } catch (error) {
    console.error("Error updating appointment:", error);
    return res.status(500).json(ApiResponse("0", "Error updating appointment", { error: error.message }));
  }
};



// Delete an appointment
exports.deleteAppointment = async (req, res) => {
  const { id } = req.params;
  try {
    const appointment = await Appointment.findByPk(id);
    if (!appointment) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }
    await appointment.destroy();
    const response = ApiResponse("1", `Appiontment Canceled Successfully`, {});

    res.status(200).json(response);
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json(ApiResponse("0", "Error canceling appointment", {}));
  }
};


// Flip a confirmed appointment to "In Progress". Mirrors the trainer
// "Start Session" pattern — without an explicit live-state, the auto-end
// cron can't distinguish a no-show from a session that ran late, so a
// no-show would be silently auto-completed.
exports.startAppointment = async (req, res) => {
  const { id } = req.params;
  const { actorUserId } = req.body;

  try {
    const appointment = await Appointment.findOne({ where: { id } });
    if (!appointment) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }

    if (appointment.status !== "confirmed") {
      return res.status(200).json(
        ApiResponse(
          "0",
          `Cannot start an appointment in status "${appointment.status}". Confirm it first.`,
          {}
        )
      );
    }

    appointment.status = "In Progress";
    appointment.completed_by = actorUserId != null ? actorUserId : appointment.dietitionId;
    appointment.status_changed_at = new Date();
    await appointment.save();

    return res.status(200).json(
      ApiResponse("1", "Appointment started", { appointment })
    );
  } catch (error) {
    console.error("Start error:", error);
    return res.status(500).json(
      ApiResponse("0", "Error starting appointment", { error: error.message })
    );
  }
};

// Per-consultation review. Only the user who attended the consultation
// can leave one, and only after status is `completed`. The unique index
// on appointmentId means a second submission updates the existing row
// rather than creating a duplicate.
exports.createAppointmentReview = async (req, res) => {
  const { id } = req.params;
  const { rating, comment } = req.body;

  if (!req.user || !req.user.id) {
    return res.json(ApiResponse("0", "User not loggedIn!", {}));
  }

  const ratingInt = Number(rating);
  if (!Number.isInteger(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return res.json(ApiResponse("0", "Rating must be an integer 1-5", {}));
  }

  try {
    const appointment = await Appointment.findOne({ where: { id } });
    if (!appointment) {
      return res.status(404).json(ApiResponse("0", "Appointment not found", {}));
    }
    if (appointment.userId !== req.user.id) {
      return res.json(ApiResponse("0", "You can only review your own consultations", {}));
    }
    if (appointment.status !== "completed") {
      return res.json(
        ApiResponse(
          "0",
          `Cannot review an appointment in status "${appointment.status}". Only completed consultations can be reviewed.`,
          {}
        )
      );
    }

    // Upsert via the unique index on appointmentId — re-submission
    // updates the existing row, so users can correct a typo without
    // hitting a duplicate-key error.
    const existing = await AppointmentReview.findOne({ where: { appointmentId: id } });
    let review;
    if (existing) {
      existing.rating = ratingInt;
      existing.comment = comment ?? null;
      await existing.save();
      review = existing;
    } else {
      review = await AppointmentReview.create({
        appointmentId: appointment.id,
        userId: req.user.id,
        rating: ratingInt,
        comment: comment ?? null,
      });
    }

    return res.json(ApiResponse("1", "Review saved", { review }));
  } catch (error) {
    console.error("Review error:", error);
    return res.status(500).json(
      ApiResponse("0", "Error saving review", { error: error.message })
    );
  }
};

// Get all clients (appointments) where reshadule is true
exports.getAllRescheduledAppointments = async (req, res) => {
 
  try {
  const { reschedule } = req.params;

    const appointments = await Appointment.findAll({
      where: { reschedule: reschedule },
      attributes: { exclude: ["createdAt", "updatedAt"] },
      include: [
        {
          model: User,
          attributes: ["id", "firstName", "lastName", "email"],
          as: "ClientUser",
        },
        {
          model: SlotDiet,
          attributes: { exclude: ["createdAt", "updatedAt"] },
        },
      ],
    });

    const response = ApiResponse("1", "Rescheduled appointments fetched successfully", { appointments });
    return res.status(200).json(response);
  } catch (error) {
    const response = ApiResponse("0", `Error fetching rescheduled appointments: ${error.message}`, {});
    return res.status(500).json(response);
  }
};
