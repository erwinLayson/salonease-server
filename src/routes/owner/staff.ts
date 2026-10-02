import { Router } from "express";
import * as controller from "../../controller/staff.js";
import * as schedulingController from "../../controller/scheduling.js";

/** Owner staff management. Mounted at /api/owner/staff (owner-only). */
const router = Router();

router.get("/", controller.listStaff);
router.post("/", controller.createStaff);
router.get("/:id", controller.getStaff);
router.put("/:id", controller.updateStaff);
router.patch("/:id/status", controller.setStaffStatus);
router.get("/:id/deactivation-impact", controller.getDeactivationImpact);
router.get("/:id/services", controller.getStaffServices);
router.put("/:id/services", controller.setStaffServices);
router.get("/:id/schedules", schedulingController.getWeeklySchedule);
router.put("/:id/schedules", schedulingController.replaceWeeklySchedule);
router.delete("/:id", controller.deleteStaff);

export default router;
