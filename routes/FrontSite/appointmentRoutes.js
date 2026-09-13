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
 router.get("/rescheduled/appointments/:reschedule/:dietitianId", appointmentController.getAllRescheduledAppointments);

 router.get("/status", appointmentController.getAllAppointmentStatus);

// User-facing counterpart to /dietAppointments/:id below — the caller's
// own current active booking, for the Diet tab's "your booked
// consultation" card. Registered before the generic "/:id" route.
 router.get("/me/current", validateToken, consultationBookingController.getMyCurrentAppointment);

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

// User-initiated cancel (ownership-checked, only from pending/confirmed).
// Distinct from the dietitian-facing PUT /:id below, which trusts the
// caller and allows any status transition.
 router.post("/:id/cancel", validateToken, consultationBookingController.cancelMyAppointment);

// Per-consultation review by the client. Auth-gated; the controller
// enforces that req.user.id matches the appointment's userId.
 router.post("/:id/review", validateToken, appointmentController.createAppointmentReview);

// Route to update an existing appointment
 router.put("/:id", appointmentController.updateAppointment);

// Route to delete an appointment
 router.delete("/:id", appointmentController.deleteAppointment);

module.exports = router;
