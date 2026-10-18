import { Router } from "express";
import * as controller from "../controller/notifications.js";

/** Shared authenticated routes for the in-app notification inbox. */
const router = Router();

router.get("/", controller.list);
router.patch("/:id/read", controller.markRead);

export default router;
