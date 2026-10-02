import { Router } from "express";
import * as controller from "../../controller/services.js";

/** Owner service management. Mounted at /api/owner/services (owner-only). */
const router = Router();

router.get("/", controller.listServices);
router.post("/", controller.createService);
router.get("/:id", controller.getService);
router.put("/:id", controller.updateService);
router.patch("/:id/status", controller.setServiceStatus);
router.delete("/:id", controller.deleteService);

export default router;
