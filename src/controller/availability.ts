import { asyncHandler } from "../helper/asyncHandler.js";
import {
    optionalInteger,
    requireDateString,
    requireIdParam,
    requireMonth,
} from "../helper/validation.js";
import * as availabilityService from "../service/availability.js";
import * as serviceService from "../service/services.js";

// Types
import type { Request } from "express";

const parseAvailabilityQuery = (req: Request) => {
    const serviceId =
        typeof req.query.serviceId === "string" ? req.query.serviceId : "";
    const staffId = optionalInteger(req.query.staffId, "staffId");

    return {
        serviceId: requireIdParam(serviceId, "serviceId"),
        date: requireDateString(req.query.date, "date"),
        staffId,
    };
};

/**
 * GET /api/owner/availability?serviceId=&date=&staffId=&walkIn=true
 *
 * `walkIn=true` drops the online lead time / advance-booking window so the owner
 * can record a same-day walk-in; working hours, leave and conflicts still apply.
 */
export const getAvailability = asyncHandler(async (req, res) => {
    const result = await availabilityService.getAvailability({
        ...parseAvailabilityQuery(req),
        walkIn: req.query.walkIn === "true",
    });
    res.status(200).json({ success: true, data: result });
});

/** GET /api/public/availability?serviceId=&date=&staffId= */
export const getPublicAvailability = asyncHandler(async (req, res) => {
    const result = await availabilityService.getAvailability(parseAvailabilityQuery(req));
    res.status(200).json({ success: true, data: result });
});

/** GET /api/public/availability-month?serviceId=&month=YYYY-MM&staffId= */
export const getPublicMonthAvailability = asyncHandler(async (req, res) => {
    const serviceId = requireIdParam(
        typeof req.query.serviceId === "string" ? req.query.serviceId : "",
        "serviceId"
    );
    const month = requireMonth(req.query.month, "month");
    const staffId = optionalInteger(req.query.staffId, "staffId");

    const result = await availabilityService.getMonthAvailability({
        serviceId,
        month,
        staffId,
    });
    res.status(200).json({ success: true, data: result });
});

/**
 * GET /api/owner/availability-month?serviceId=&month=YYYY-MM&staffId=&walkIn=true
 *
 * Same as the public month endpoint but owner-only and with `walkIn` support, so
 * the walk-in calendar includes today's remaining slots and future dates beyond
 * the online booking window.
 */
export const getOwnerMonthAvailability = asyncHandler(async (req, res) => {
    const serviceId = requireIdParam(
        typeof req.query.serviceId === "string" ? req.query.serviceId : "",
        "serviceId"
    );
    const month = requireMonth(req.query.month, "month");
    const staffId = optionalInteger(req.query.staffId, "staffId");

    const result = await availabilityService.getMonthAvailability({
        serviceId,
        month,
        staffId,
        walkIn: req.query.walkIn === "true",
    });
    res.status(200).json({ success: true, data: result });
});

/** GET /api/public/services — active services only (FR-GB4). */
export const listPublicServices = asyncHandler(async (_req, res) => {
    const services = await serviceService.listServices(false);
    res.status(200).json({
        success: true,
        data: services.map((service) => ({
            id: service.id,
            name: service.name,
            description: service.description,
            price: service.price,
            durationMinutes: service.duration_minutes,
        })),
    });
});

/** GET /api/public/staff?serviceId= — active, eligible staff only (FR-GB4). */
export const listPublicStaff = asyncHandler(async (req, res) => {
    const serviceId =
        typeof req.query.serviceId === "string" ? req.query.serviceId : "";
    const staff = await availabilityService.listStaffForService(
        requireIdParam(serviceId, "serviceId")
    );
    res.status(200).json({ success: true, data: staff });
});
