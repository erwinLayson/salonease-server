import { Router } from "express";
import * as leaveRequestsController from "../../controller/leaveRequests.js";

/** Owner leave-request management. Mounted at /api/owner (owner-only). */
const router = Router();

router.get("/leave-requests", leaveRequestsController.listAll);
router.get("/leave-requests/:id/conflicts", leaveRequestsController.getConflicts);
router.post("/leave-requests/:id/approve", leaveRequestsController.approve);
router.post("/leave-requests/:id/reject", leaveRequestsController.reject);
router.post("/leave-requests/:id/cancel", leaveRequestsController.cancelApproved);

export default router;
