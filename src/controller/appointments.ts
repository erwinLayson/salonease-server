import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalEmail,
    optionalInteger,
    optionalPhone,
    optionalString,
    requireDateString,
    requireDateTimeString,
    requireIdParam,
    requireString,
} from "../helper/validation.js";
import { combineDateTime, endOfDay } from "../helper/time.js";
import { APPOINTMENT_STATUSES } from "../constant/appointments.js";
import * as appointmentsService from "../service/appointments.js";

// Types
import type { Request } from "express";
import type { AppointmentFilter, AppointmentStatus } from "../model/appointments.js";

/** True when a query/body value was actually supplied. */
const present = (value: unknown): boolean =>
    value !== undefined && value !== null && value !== "";

/** Reads, validates, and normalises the appointment list filters. */
const parseFilters = (req: Request): AppointmentFilter => {
    let from: Date | null = null;
    let to: Date | null = null;

    if (present(req.query.date)) {
        from = combineDateTime(requireDateString(req.query.date, "date"), "00:00:00");
        to = endOfDay(from);
    } else {
        if (present(req.query.from)) {
            from = combineDateTime(requireDateString(req.query.from, "from"), "00:00:00");
        }
        if (present(req.query.to)) {
            to = endOfDay(combineDateTime(requireDateString(req.query.to, "to"), "00:00:00"));
        }
    }

    let status: AppointmentStatus | null = null;
    if (present(req.query.status)) {
        const raw = requireString(req.query.status, "status", 20);
        if (!APPOINTMENT_STATUSES.includes(raw as AppointmentStatus)) {
            throw new BadRequestError(
                `status must be one of: ${APPOINTMENT_STATUSES.join(", ")}`
            );
        }
        status = raw as AppointmentStatus;
    }

    return {
        from,
        to,
        staffId: optionalInteger(req.query.staffId, "staffId"),
        status,
        search: optionalString(req.query.search, "search", 120),
    };
};

/** Validates a status value against the five allowed statuses. */
const parseStatus = (value: unknown): AppointmentStatus => {
    const status = requireString(value, "status", 20);
    if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
        throw new BadRequestError(`status must be one of: ${APPOINTMENT_STATUSES.join(", ")}`);
    }
    return status as AppointmentStatus;
};

/** GET /api/owner/appointments?date=|from=&to=&staffId=&status=&search= */
export const listAppointments = asyncHandler(async (req, res) => {
    const data = await appointmentsService.listAppointments(parseFilters(req));
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/appointments/:id */
export const getAppointment = asyncHandler(async (req, res) => {
    const data = await appointmentsService.getAppointment(requireIdParam(req.params.id));
    res.status(200).json({ success: true, data });
});

/** PATCH /api/owner/appointments/:id/status  { status, reason? } */
export const changeStatus = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await appointmentsService.changeStatus(id, parseStatus(body.status), {
        reason: optionalString(body.reason, "reason", 255),
    });

    res.status(200).json({ success: true, data });
});

/** POST /api/owner/appointments/:id/reschedule  { startAt, staffId? } */
export const rescheduleAppointment = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await appointmentsService.rescheduleAppointment(id, {
        startAt: requireDateTimeString(body.startAt, "startAt"),
        staffId: optionalInteger(body.staffId, "staffId"),
    });

    res.status(200).json({ success: true, data });
});

/** PATCH /api/owner/appointments/:id  { notes?, serviceId?, staffId?, startAt? } */
export const updateAppointment = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await appointmentsService.updateAppointment(id, {
        notes: body.notes === undefined ? undefined : optionalString(body.notes, "notes", 2000),
        serviceId: present(body.serviceId)
            ? requireIdParam(String(body.serviceId), "serviceId")
            : undefined,
        staffId: present(body.staffId)
            ? requireIdParam(String(body.staffId), "staffId")
            : undefined,
        startAt: present(body.startAt)
            ? requireDateTimeString(body.startAt, "startAt")
            : undefined,
    });

    res.status(200).json({ success: true, data });
});

/** POST /api/owner/appointments — manual (walk-in / phone) booking. */
export const createManualBooking = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const firstName = requireString(body.firstName, "firstName", 80);
    const lastName = optionalString(body.lastName, "lastName", 80);
    const phone = optionalPhone(body.phone, "phone");
    const email = optionalEmail(body.email, "email");

    if (!phone && !email) {
        throw new BadRequestError(
            "Please provide a phone number or an email address for the customer."
        );
    }

    const data = await appointmentsService.createManualBooking({
        customer: { firstName, lastName, phone, email },
        staffId: requireIdParam(String(body.staffId ?? ""), "staffId"),
        serviceId: requireIdParam(String(body.serviceId ?? ""), "serviceId"),
        startAt: requireDateTimeString(body.startAt, "startAt"),
        notes: optionalString(body.notes, "notes", 2000),
        createdBy: req.user?.id ?? null,
    });

    res.status(201).json({ success: true, data });
});

/** GET /api/staff/appointments — only the signed-in staff member's own bookings. */
export const listMyAppointments = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const data = await appointmentsService.listAppointmentsForStaffUser(
        req.user.id,
        parseFilters(req)
    );
    res.status(200).json({ success: true, data });
});

/** GET /api/staff/appointments/:id — 404 unless it belongs to the caller. */
export const getMyAppointment = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const data = await appointmentsService.getAppointmentForStaffUser(
        req.user.id,
        requireIdParam(req.params.id)
    );
    res.status(200).json({ success: true, data });
});

/**
 * PATCH /api/staff/appointments/:id/status  { status }
 *
 * Staff may only confirm or complete their own appointments.
 * Completing auto-creates the billing transaction.
 */
export const changeMyAppointmentStatus = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await appointmentsService.changeStatusForStaffUser(
        req.user.id,
        requireIdParam(req.params.id),
        parseStatus(body.status),
        { reason: optionalString(body.reason, "reason", 255) }
    );
    res.status(200).json({ success: true, data });
});
