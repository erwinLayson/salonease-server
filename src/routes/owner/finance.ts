import { Router } from "express";
import * as controller from "../../controller/finance.js";

/** Owner daily close and report routes. Mounted at /api/owner. */
const router = Router();

router.get("/closures", controller.listClosures);
router.get("/closures/:date", controller.getClosure);
router.post("/closures", controller.closeDay);
router.post("/closures/:date/reopen", controller.reopenDay);

router.get("/reports/daily-sales", controller.salesReport);
router.get("/reports/wait-times", controller.waitTimesReport);
router.get("/reports/reconciliation", controller.reconciliationReport);

export default router;
