const express = require("express");
const router = express.Router();
const appointmentController = require("../../controllers/FrontSite/appointmentController");
const consultationBookingController = require("../../controllers/FrontSite/consultationBookingController");
const { validateToken } = require("../../middlewares/AuthorizationMW");
// const authenticate = require('../middleware/middlewares/authMiddleware');

// // Create a new appointment (requires authentication)
// router.post('/', authenticate, appointmentController.createAppointment);

// // Get all appointments (requires authentication)
// router.get('/', authenticate, appointmentController.getAvailableTimeSlots);

// // Get a single appointment by ID (requires authentication)
// router.get('/:id', authenticate, appointmentController.getAppointmentById);

// // Update an appointment by ID (requires authentication)
// router.put('/:id', authenticate, appointmentController.updateAppointment);

// // Delete an appointment by ID (requires authentication)
// router.delete('/:id', authenticate, appointmentController.deleteAppointment);
 router.get("/rescheduled/appointments/:reschedule", appointmentController.getAllRescheduledAppointments);

 router.get("/status", appointmentController.getAllAppointmentStatus);


// Route to get all appointments
 router.get("/dietAppointments/:id", appointmentController.getAllAppointments);

// Route to get an appointment by ID
 router.get("/:id", appointmentController.getAppointmentById);

// Route to create a new appointment
 router.post("/", appointmentController.createAppointment);

// Route to flip confirmed → In Progress when the dietitian starts the session
 router.post("/:id/start", appointmentController.startAppointment);

// User reports the dietitian didn't show up. Auth-gated; controller
// enforces ownership. Opens a CONSULT_NO_SHOW escalation. Phase 1B addition.
 router.post("/:id/no-show", validateToken, consultationBookingController.reportNoShow);

// Per-consultation review by the client. Auth-gated; the controller
// enforces that req.user.id matches the appointment's userId.
 router.post("/:id/review", validateToken, appointmentController.createAppointmentReview);

// Route to update an existing appointment
 router.put("/:id", appointmentController.updateAppointment);

// Route to delete an appointment
 router.delete("/:id", appointmentController.deleteAppointment);

module.exports = router;
