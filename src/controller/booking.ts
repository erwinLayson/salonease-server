import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, NotFoundError } from "../helper/error.js";
import {
    optionalEmail,
    optionalInteger,
    optionalPhone,
    optionalString,
    requireDateTimeString,
    requireIdParam,
    requireString,
} from "../helper/validation.js";
import * as guestBookingService from "../service/guestBooking.js";

// Types
import type { GuestContact } from "../service/guestBooking.js";

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Validates the guest's name and contact details (FR-GB5, FR-GB6). */
const parseContact = (body: Record<string, unknown>): GuestContact => {
    const firstName = requireString(body.firstName, "firstName", 80);
    const lastName = optionalString(body.lastName, "lastName", 80);
    const phone = optionalPhone(body.phone, "phone");
    const email = optionalEmail(body.email, "email");

    if (!phone && !email) {
        throw new BadRequestError(
            "Please provide a phone number or an email address so we can contact you."
        );
    }

    return { firstName, lastName, phone, email };
};

/** Reads and sanity-checks the 64-char manage token from the URL. */
const parseManageToken = (value: unknown): string => {
    const token = requireString(value, "token", 128);

    // Treat malformed tokens as "not found" so they cannot be probed.
    if (!TOKEN_PATTERN.test(token)) {
        throw new NotFoundError("Booking not found", 404);
    }

    return token;
};

/** POST /api/public/bookings */
export const createBooking = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const outcome = await guestBookingService.createGuestBooking({
        serviceId: requireIdParam(String(body.serviceId ?? ""), "serviceId"),
        staffId: optionalInteger(body.staffId, "staffId"),
        startAt: requireDateTimeString(body.startAt, "startAt"),
        customer: parseContact(body),
    });

    if (!outcome.ok) {
        res.status(409).json({
            success: false,
            message: outcome.message,
            alternatives: outcome.alternatives,
        });
        return;
    }

    res.status(201).json({
        success: true,
        data: outcome.appointment,
        manageUrl: outcome.manageUrl,
    });
});

/** GET /api/public/bookings/:token */
export const getBooking = asyncHandler(async (req, res) => {
    const booking = await guestBookingService.getManagedBooking(
        parseManageToken(req.params.token)
    );
    res.status(200).json({ success: true, data: booking });
});

/** POST /api/public/bookings/:token/cancel */
export const cancelBooking = asyncHandler(async (req, res) => {
    const booking = await guestBookingService.cancelManagedBooking(
        parseManageToken(req.params.token)
    );
    res.status(200).json({ success: true, data: booking });
});

/** POST /api/public/bookings/:token/reschedule-request */
export const requestReschedule = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const preferredStartAt =
        body.preferredStartAt === undefined || body.preferredStartAt === null || body.preferredStartAt === ""
            ? null
            : requireDateTimeString(body.preferredStartAt, "preferredStartAt");

    const result = await guestBookingService.requestReschedule(
        parseManageToken(req.params.token),
        {
            preferredStartAt,
            note: optionalString(body.note, "note", 200),
        }
    );

    res.status(202).json({ success: true, data: result });
});
