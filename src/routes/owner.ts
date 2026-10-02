import { Router } from "express";
import { requireRole } from "../middleware/authorize.js";
import staffRouter from "./owner/staff.js";
import servicesRouter from "./owner/services.js";
import schedulingRouter from "./owner/scheduling.js";
import appointmentsRouter from "./owner/appointments.js";
import transactionsRouter from "./owner/transactions.js";

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
router.use("/", appointmentsRouter);
router.use("/", transactionsRouter);

export default router;
