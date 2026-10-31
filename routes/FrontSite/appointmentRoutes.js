const express = require("express");
const router = express.Router();
const appointmentController = require("../../controllers/FrontSite/appointmentController");
const consultationBookingController = require("../../controllers/FrontSite/consultationBookingController");
const { validateToken } = require("../../middlewares/AuthorizationMW");
const { validateAdmin } = require("../../middlewares/ValidateAdmin");
const { selfOrStaff } = require("../../middlewares/roleGuards");
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
 // Sec pass 1: a dietitian sees only her own queue; Admin may open any.
 router.get("/rescheduled/appointments/:reschedule/:dietitianId", validateToken, selfOrStaff("params.dietitianId", ["Admin"]), appointmentController.getAllRescheduledAppointments);

 router.get("/status", validateToken, appointmentController.getAllAppointmentStatus);

// User-facing counterpart to /dietAppointments/:id below — the caller's
// own current active booking, for the Diet tab's "your booked
// consultation" card. Registered before the generic "/:id" route.
 router.get("/me/current", validateToken, consultationBookingController.getMyCurrentAppointment);

// Route to get all appointments
 router.get("/dietAppointments/:id", validateToken, validateAdmin, appointmentController.getAllAppointments);

// Route to get an appointment by ID
 router.get("/:id", validateToken, appointmentController.getAppointmentById);

// Route to create a new appointment
 // Logged in, and a client may only book for herself (staff for anyone).
 router.post("/", selfOrStaff("body.userId"), appointmentController.createAppointment);

// Route to flip confirmed → In Progress when the dietitian starts the session
 router.post("/:id/start", validateToken, validateAdmin, appointmentController.startAppointment);

// User reports the dietitian didn't show up. Auth-gated; controller
// enforces ownership. Opens a CONSULT_NO_SHOW escalation. Phase 1B addition.
 // Retired (Oct 2026): the server decides dietitian no-shows itself
 // (Meet attendance sweep, or the 24h fallback in popupEligibility), so
 // the client is never asked to report one. Kept for reference.
 // (route removed; see consultationBookingController.js)
// Client tapped "Join Meeting" in the app (Oct 2026): first tap time,
// for attendance with every dietitian (Google or not). Own bookings only.
router.post("/:id/join-tap", validateToken, consultationBookingController.recordJoinTap);

// Dietitian: "Client didn't join" (manual backup for the Meet attendance check).
router.post("/:id/client-no-show", validateToken, consultationBookingController.reportClientNoShow);
// Dietitian: "Yes, she joined" (no Join tap in the app). Oct 2026.
router.post("/:id/client-joined", validateToken, consultationBookingController.confirmClientJoined);

// User-initiated cancel (ownership-checked, only from pending/confirmed).
// Distinct from the dietitian-facing PUT /:id below.
 router.post("/:id/cancel", validateToken, consultationBookingController.cancelMyAppointment);

// Per-consultation review by the client. Auth-gated; the controller
// enforces that req.user.id matches the appointment's userId.
 router.post("/:id/review", validateToken, appointmentController.createAppointmentReview);

// Dietitian-facing confirm/cancel/status-update. Used to have no auth
// at all — anyone who knew an appointment id could flip its status.
// Now behind validateToken + validateAdmin; the controller enforces
// that the caller owns the appointment (or is an Admin).
 router.put("/:id", validateToken, validateAdmin, appointmentController.updateAppointment);

// Route to delete an appointment
 router.delete("/:id", validateToken, validateAdmin, appointmentController.deleteAppointment);

module.exports = router;
