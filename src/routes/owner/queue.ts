import { Router } from "express";
import * as queueController from "../../controller/queue.js";

/** Owner walk-in queue. Mounted at /api/owner (owner-only). */
const router = Router();

router.get("/queue", queueController.listQueue);
router.post("/queue", queueController.createTicket);
router.get("/queue/:id", queueController.getTicket);
router.patch("/queue/:id/status", queueController.changeStatus);
router.post("/queue/:id/convert", queueController.convertTicket);
router.get("/queue/:id/assignment-check", queueController.checkAssignment);

export default router;
