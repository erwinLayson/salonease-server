import { Router } from "express";
import * as controller from "../../controller/events.js";

/** Owner event and venue management. Mounted at /api/owner (owner-only). */
const router = Router();

router.get("/venues", controller.listVenues);
router.post("/venues", controller.createVenue);
router.put("/venues/:id", controller.updateVenue);

router.get("/events", controller.listEvents);
router.post("/events", controller.createEvent);
router.get("/events/:id", controller.getEvent);
router.put("/events/:id", controller.updateEvent);
router.patch("/events/:id/status", controller.changeStatus);
router.put("/events/:id/itinerary", controller.replaceItinerary);
router.put("/events/:id/supplies", controller.replaceSupplies);
router.post("/events/:id/supplies/issue", controller.issueSupplies);
router.post("/events/:id/supplies/settle", controller.settleSupplies);

export default router;
