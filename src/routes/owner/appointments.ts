import { Router } from "express";
import * as appointmentsController from "../../controller/appointments.js";
import * as scheduleViewController from "../../controller/scheduleView.js";

/** Owner appointment management + schedule views. Mounted at /api/owner (owner-only). */
const router = Router();

router.get("/appointments", appointmentsController.listAppointments);
router.post("/appointments", appointmentsController.createManualBooking);
router.get("/appointments/:id", appointmentsController.getAppointment);
router.patch("/appointments/:id", appointmentsController.updateAppointment);
router.patch("/appointments/:id/status", appointmentsController.changeStatus);
router.post("/appointments/:id/reschedule", appointmentsController.rescheduleAppointment);

router.get("/schedule", scheduleViewController.getOwnerSchedule);

export default router;
