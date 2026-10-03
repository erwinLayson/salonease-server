import { Router } from "express";
import { requireRole } from "../middleware/authorize.js";
import * as appointmentsController from "../controller/appointments.js";
import * as leaveRequestsController from "../controller/leaveRequests.js";
import * as scheduleViewController from "../controller/scheduleView.js";
import * as staffController from "../controller/staff.js";
import * as transactionsController from "../controller/transactions.js";

/**
 * Staff-only routes.
 *
 * Every handler scopes its query to the signed-in staff member's own staff row,
 * so a staff member can only ever see their own appointments, schedule and
 * leave requests (FR-AP5). Another staff member's appointment id returns 404.
 */
const router: Router = Router();

router.use(requireRole("staff"));

router.get("/profile", staffController.getOwnProfile);
router.put("/profile", staffController.updateOwnProfile);

router.get("/appointments", appointmentsController.listMyAppointments);
router.get("/appointments/:id", appointmentsController.getMyAppointment);
router.patch(
    "/appointments/:id/status",
    appointmentsController.changeMyAppointmentStatus
);
router.get("/appointments/:id/transaction", transactionsController.getMyTransaction);
router.patch(
    "/appointments/:id/transaction",
    transactionsController.updateMyTransaction
);

/** Billing history for the caller's own completed appointments. */
router.get("/transactions", transactionsController.listMyTransactions);
router.get("/schedule", scheduleViewController.getStaffSchedule);

/** Leave requests: the caller may only submit, list and withdraw their own. */
router.get("/leave-requests", leaveRequestsController.listMine);
router.post("/leave-requests", leaveRequestsController.createMine);
router.patch("/leave-requests/:id/cancel", leaveRequestsController.cancelMine);

/**
 * Calendar overlay: whose leave (any staff) overlaps a range, so a request
 * can be timed around colleagues' time off.
 */
router.get("/leave-requests/coverage", leaveRequestsController.coverage);

export default router;
