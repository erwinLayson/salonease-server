import { Router } from "express";
import { requireRole } from "../middleware/authorize.js";
import staffRouter from "./owner/staff.js";
import servicesRouter from "./owner/services.js";
import schedulingRouter from "./owner/scheduling.js";
import leaveRequestsRouter from "./owner/leaveRequests.js";
import appointmentsRouter from "./owner/appointments.js";
import transactionsRouter from "./owner/transactions.js";
import queueRouter from "./owner/queue.js";
import inventoryRouter from "./owner/inventory.js";
import eventsRouter from "./owner/events.js";
import financeRouter from "./owner/finance.js";

/**
 * Owner-only routes. `requireRole("owner")` runs before every route in this
 * router, so a staff session is rejected with 403 before any handler executes.
 */
const router = Router();

router.use(requireRole("owner"));

/** Legacy dashboard scaffold — kept for backward compat; real KPIs live at /dashboard/summary. */
router.get("/dashboard", (req, res) => {
    res.status(200).json({ success: true, scope: "owner", user: req.user });
});

router.use("/staff", staffRouter);
router.use("/services", servicesRouter);
router.use("/", schedulingRouter);
router.use("/", leaveRequestsRouter);
router.use("/", appointmentsRouter);
router.use("/", transactionsRouter);
router.use("/", queueRouter);
router.use("/", inventoryRouter);
router.use("/", eventsRouter);
router.use("/", financeRouter);

export default router;
