import { Router } from "express";
import * as availabilityController from "../controller/availability.js";
import * as bookingController from "../controller/booking.js";
import * as staffController from "../controller/staff.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { RATE_LIMITS } from "../config/booking.js";

/**
 * Public (unauthenticated) routes — the guest booking flow only (FR-A8).
 *
 * Read-only endpoints power the booking UI; the write endpoints (create booking,
 * cancel, reschedule request) are rate-limited as spam protection (FR-GB7) and
 * rely on an unguessable manage token instead of authentication.
 */
const router = Router();

/** Spam protection for booking creation and manage-link actions. */
const bookingLimiter = rateLimit({ ...RATE_LIMITS.booking, keyPrefix: "booking" });
const manageLimiter = rateLimit({ ...RATE_LIMITS.manage, keyPrefix: "manage" });

router.get("/health", (_req, res) => {
    res.status(200).json({ success: true, scope: "public" });
});

router.get("/services", availabilityController.listPublicServices);
router.get("/staff", availabilityController.listPublicStaff);
router.get("/team", staffController.listPublicTeam);
router.get("/availability", availabilityController.getPublicAvailability);
router.get("/availability-month", availabilityController.getPublicMonthAvailability);

router.post("/bookings", bookingLimiter, bookingController.createBooking);
router.get("/bookings/:token", manageLimiter, bookingController.getBooking);
router.post("/bookings/:token/cancel", manageLimiter, bookingController.cancelBooking);
router.post(
    "/bookings/:token/reschedule-request",
    manageLimiter,
    bookingController.requestReschedule
);

export default router;
