import { Router } from "express";
import * as schedulingController from "../../controller/scheduling.js";
import * as availabilityController from "../../controller/availability.js";

/** Owner scheduling + availability preview. Mounted at /api/owner (owner-only). */
const router = Router();

router.get("/availability", availabilityController.getAvailability);
router.get("/availability-month", availabilityController.getOwnerMonthAvailability);

router.get("/schedule-exceptions", schedulingController.listExceptions);
router.post("/schedule-exceptions", schedulingController.createException);
router.delete("/schedule-exceptions/:id", schedulingController.deleteException);

export default router;
