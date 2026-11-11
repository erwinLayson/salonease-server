import { Router } from "express";
import * as controller from "../../controller/inventory.js";

/** Owner inventory. Mounted at /api/owner (owner-only). */
const router = Router();

router.get("/supplies", controller.listSupplies);
router.post("/supplies", controller.createSupply);
router.get("/supplies/:id", controller.getSupply);
router.put("/supplies/:id", controller.updateSupply);
router.patch("/supplies/:id/status", controller.setSupplyStatus);
router.get("/supplies/:id/movements", controller.listMovements);
router.post("/supplies/:id/movements", controller.createMovement);

router.get("/inventory/alerts", controller.listAlerts);
router.patch("/inventory/alerts/:id/acknowledge", controller.acknowledgeAlert);
router.patch("/inventory/alerts/:id/resolve", controller.resolveAlert);
router.get("/inventory/summary", controller.summary);
router.get("/inventory/recipes", controller.listAllRecipes);

router.get("/reports/inventory", controller.usageReport);

export default router;
