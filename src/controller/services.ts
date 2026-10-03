import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError } from "../helper/error.js";
import { BOOKING_RULES } from "../config/booking.js";
import {
    optionalString,
    requireBoolean,
    requireDateString,
    requireIdParam,
    requireInteger,
    requireNumber,
    requireString,
} from "../helper/validation.js";
import { formatDate } from "../helper/time.js";
import * as serviceService from "../service/services.js";
import * as availabilityService from "../service/availability.js";

// Types
import type { CreateServiceInput } from "../constant/services.js";

const MAX_DURATION_MINUTES = 24 * 60;

/** Parses and validates a service payload. */
const parseServiceBody = (body: unknown): CreateServiceInput => {
    const input = (body ?? {}) as Record<string, unknown>;

    const name = requireString(input.name, "name", 120);
    const description = optionalString(input.description, "description", 2000);

    const price = requireNumber(input.price, "price");
    if (price < 0) {
        throw new BadRequestError("price must be 0 or more");
    }
    if (Math.abs(Math.round(price * 100) - price * 100) > 1e-9) {
        throw new BadRequestError("price must have at most 2 decimal places");
    }

    const durationMinutes = requireInteger(input.durationMinutes, "durationMinutes");
    if (durationMinutes <= 0) {
        throw new BadRequestError("durationMinutes must be greater than 0");
    }
    if (durationMinutes > MAX_DURATION_MINUTES) {
        throw new BadRequestError(`durationMinutes must be ${MAX_DURATION_MINUTES} or less`);
    }
    const step = BOOKING_RULES.slotGranularityMinutes;
    if (durationMinutes % step !== 0) {
        throw new BadRequestError(`durationMinutes must be a multiple of ${step} minutes`);
    }

    return { name, description, price, durationMinutes };
};

/** GET /api/owner/services?includeInactive=true */
export const listServices = asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const services = await serviceService.listServices(includeInactive);
    res.status(200).json({ success: true, data: services });
});

/** GET /api/owner/services/:id */
export const getService = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    res.status(200).json({ success: true, data: await serviceService.getService(id) });
});

/** POST /api/owner/services */
export const createService = asyncHandler(async (req, res) => {
    const created = await serviceService.createService(parseServiceBody(req.body));
    res.status(201).json({ success: true, data: created });
});

/** PUT /api/owner/services/:id */
export const updateService = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const updated = await serviceService.updateService(id, parseServiceBody(req.body));
    res.status(200).json({ success: true, data: updated });
});

/** PATCH /api/owner/services/:id/status  { isActive } */
export const setServiceStatus = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const isActive = requireBoolean(body.isActive, "isActive");
    const updated = await serviceService.setServiceActive(id, isActive);
    res.status(200).json({ success: true, data: updated });
});

/**
 * GET /api/owner/services/:id/staff?date=YYYY-MM-DD
 *
 * Active staff eligible for the service, each with their availability status on
 * `date` (defaults to today). Powers the service-first walk-in flow.
 */
export const listServiceStaff = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    const date =
        req.query.date !== undefined && req.query.date !== null && req.query.date !== ""
            ? requireDateString(req.query.date, "date")
            : formatDate(new Date());

    const data = await availabilityService.listStaffForServiceWithStatus(id, date);
    res.status(200).json({ success: true, data });
});

/** DELETE /api/owner/services/:id */
export const deleteService = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    await serviceService.deleteService(id);
    res.status(204).send();
});
