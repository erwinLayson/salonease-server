import { Router } from "express";
import * as controller from "../../controller/finance.js";

/** Owner commission, daily close and report routes. Mounted at /api/owner. */
const router = Router();

router.get("/commission-rules", controller.listRules);
router.post("/commission-rules", controller.createRule);
router.post("/commission-rules/preview", controller.previewRule);
router.put("/commission-rules/:id", controller.updateRule);
router.delete("/commission-rules/:id", controller.deleteRule);

router.get("/commissions/entries", controller.listEntries);
router.get("/commission-payouts", controller.listPayouts);
router.post("/commission-payouts", controller.createPayout);
router.patch("/commission-payouts/:id/status", controller.updatePayoutStatus);

router.get("/closures", controller.listClosures);
router.get("/closures/:date", controller.getClosure);
router.post("/closures", controller.closeDay);
router.post("/closures/:date/reopen", controller.reopenDay);

router.get("/reports/daily-sales", controller.salesReport);
router.get("/reports/commissions", controller.commissionReport);
router.get("/reports/wait-times", controller.waitTimesReport);
router.get("/reports/reconciliation", controller.reconciliationReport);

export default router;
