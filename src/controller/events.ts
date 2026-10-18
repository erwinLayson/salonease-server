import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalEmail,
    optionalPhone,
    optionalString,
    requireBoolean,
    requireDateString,
    requireDateTimeString,
    requireIdParam,
    requireInteger,
    requireNumber,
    requireString,
} from "../helper/validation.js";
import { combineDateTime, endOfDay, startOfDay } from "../helper/time.js";
import {
    EVENT_ASSIGNMENT_ROLES,
    EVENT_ASSIGNMENT_STATUSES,
    EVENT_STATUSES,
    EVENT_TYPES,
} from "../constant/events.js";
import * as eventService from "../service/events.js";

// Types
import type { Request } from "express";
import type {
    EventAssignmentRole,
    EventAssignmentStatus,
    EventStatus,
    EventType,
} from "../constant/events.js";

const present = (value: unknown): boolean =>
    value !== undefined && value !== null && value !== "";

const parseVenueBody = (body: unknown): eventService.VenueInput => {
    const input = (body ?? {}) as Record<string, unknown>;
    return {
        name: requireString(input.name, "name", 160),
        address: requireString(input.address, "address", 255),
        contactName: optionalString(input.contactName, "contactName", 120),
        contactPhone: optionalPhone(input.contactPhone, "contactPhone"),
        notes: optionalString(input.notes, "notes", 255),
    };
};

const parseEventType = (value: unknown): EventType => {
    const raw = requireString(value, "eventType", 20);
    if (!EVENT_TYPES.includes(raw as EventType)) {
        throw new BadRequestError(`eventType must be one of: ${EVENT_TYPES.join(", ")}`);
    }
    return raw as EventType;
};

const parseAssignmentRole = (value: unknown): EventAssignmentRole => {
    const raw = requireString(value, "role", 20);
    if (!EVENT_ASSIGNMENT_ROLES.includes(raw as EventAssignmentRole)) {
        throw new BadRequestError(`role must be one of: ${EVENT_ASSIGNMENT_ROLES.join(", ")}`);
    }
    return raw as EventAssignmentRole;
};

const parseAssignmentStatus = (value: unknown): EventAssignmentStatus | undefined => {
    if (!present(value)) return undefined;
    const raw = requireString(value, "status", 20);
    if (!EVENT_ASSIGNMENT_STATUSES.includes(raw as EventAssignmentStatus)) {
        throw new BadRequestError(
            `assignment status must be one of: ${EVENT_ASSIGNMENT_STATUSES.join(", ")}`
        );
    }
    return raw as EventAssignmentStatus;
};

const parseAssignmentList = (value: unknown): eventService.EventAssignmentInput[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new BadRequestError("assignments must be an array");

    return value.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        return {
            staffId: requireIdParam(
                String(item.staffId ?? ""),
                `assignments[${index}].staffId`
            ),
            role: parseAssignmentRole(item.role),
            callTime: requireDateTimeString(
                item.callTime,
                `assignments[${index}].callTime`
            ),
            releaseTime: requireDateTimeString(
                item.releaseTime,
                `assignments[${index}].releaseTime`
            ),
            travelRequired:
                item.travelRequired === undefined
                    ? true
                    : requireBoolean(item.travelRequired, "travelRequired"),
            status: parseAssignmentStatus(item.status),
            commissionSharePercent: present(item.commissionSharePercent)
                ? requireNumber(item.commissionSharePercent, "commissionSharePercent")
                : null,
            notes: optionalString(item.notes, "notes", 255),
        };
    });
};

const parseServiceList = (value: unknown): eventService.EventServiceInput[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new BadRequestError("services must be an array");

    return value.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const quantity = requireInteger(
            item.quantity ?? 1,
            `services[${index}].quantity`
        );
        if (quantity <= 0) {
            throw new BadRequestError("Service quantity must be greater than zero");
        }
        return {
            serviceId: requireIdParam(
                String(item.serviceId ?? ""),
                `services[${index}].serviceId`
            ),
            quantity,
        };
    });
};

const parseEventBody = (body: unknown, requireCustomer = true) => {
    const input = (body ?? {}) as Record<string, unknown>;
    const customer = (input.customer ?? {}) as Record<string, unknown>;

    return {
        customer: requireCustomer
            ? {
                  firstName: requireString(customer.firstName, "customer.firstName", 80),
                  lastName: optionalString(customer.lastName, "customer.lastName", 80),
                  phone: optionalPhone(customer.phone, "customer.phone"),
                  email: optionalEmail(customer.email, "customer.email"),
              }
            : null,
        venueId: present(input.venueId)
            ? requireIdParam(String(input.venueId), "venueId")
            : null,
        title: requireString(input.title, "title", 160),
        eventType: parseEventType(input.eventType),
        startAt: requireDateTimeString(input.startAt, "startAt"),
        endAt: requireDateTimeString(input.endAt, "endAt"),
        travelBufferMinutes:
            input.travelBufferMinutes === undefined
                ? 60
                : requireInteger(input.travelBufferMinutes, "travelBufferMinutes"),
        notes: optionalString(input.notes, "notes", 2000),
        services: parseServiceList(input.services),
        assignments: parseAssignmentList(input.assignments),
    };
};

const parseEventFilters = (req: Request) => {
    let from: Date | null = null;
    let to: Date | null = null;

    if (present(req.query.from)) {
        from = combineDateTime(requireDateString(req.query.from, "from"), "00:00:00");
    }
    if (present(req.query.to)) {
        to = endOfDay(combineDateTime(requireDateString(req.query.to, "to"), "00:00:00"));
    }

    let status: EventStatus | null = null;
    if (present(req.query.status)) {
        const raw = requireString(req.query.status, "status", 20);
        if (!EVENT_STATUSES.includes(raw as EventStatus)) {
            throw new BadRequestError(
                `status must be one of: ${EVENT_STATUSES.join(", ")}`
            );
        }
        status = raw as EventStatus;
    }

    return {
        from,
        to,
        status,
        search: optionalString(req.query.search, "search", 120),
    };
};

// --- Venues ---

/** GET /api/owner/venues?includeInactive=true */
export const listVenues = asyncHandler(async (req, res) => {
    const data = await eventService.listVenues(req.query.includeInactive === "true");
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/venues */
export const createVenue = asyncHandler(async (req, res) => {
    const data = await eventService.createVenue(parseVenueBody(req.body));
    res.status(201).json({ success: true, data });
});

/** PUT /api/owner/venues/:id */
export const updateVenue = asyncHandler(async (req, res) => {
    const data = await eventService.updateVenue(
        requireIdParam(req.params.id),
        parseVenueBody(req.body)
    );
    res.status(200).json({ success: true, data });
});

// --- Events ---

/** GET /api/owner/events?from=&to=&status=&search= */
export const listEvents = asyncHandler(async (req, res) => {
    const data = await eventService.listEvents(parseEventFilters(req));
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/events/:id */
export const getEvent = asyncHandler(async (req, res) => {
    const data = await eventService.getEvent(requireIdParam(req.params.id));
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/events */
export const createEvent = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const parsed = parseEventBody(req.body);
    if (!parsed.customer) throw new BadRequestError("Customer details are required");
    const data = await eventService.createEvent({
        ...parsed,
        customer: parsed.customer,
        createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data });
});

/** PUT /api/owner/events/:id */
export const updateEvent = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parseEventBody(body, false);

    // The event's customer is fixed after creation; only update event fields.
    const data = await eventService.updateEvent(requireIdParam(req.params.id), {
        venueId: parsed.venueId,
        title: parsed.title,
        eventType: parsed.eventType,
        startAt: parsed.startAt,
        endAt: parsed.endAt,
        travelBufferMinutes: parsed.travelBufferMinutes,
        notes: parsed.notes,
        services: body.services === undefined ? undefined : parsed.services,
        assignments: body.assignments === undefined ? undefined : parsed.assignments,
    });
    res.status(200).json({ success: true, data });
});

/** PATCH /api/owner/events/:id/status { status } */
export const changeStatus = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = requireString(body.status, "status", 20);
    if (!EVENT_STATUSES.includes(raw as EventStatus)) {
        throw new BadRequestError(`status must be one of: ${EVENT_STATUSES.join(", ")}`);
    }
    const data = await eventService.changeEventStatus(
        requireIdParam(req.params.id),
        raw as EventStatus
    );
    res.status(200).json({ success: true, data });
});

// --- Itinerary ---

/** PUT /api/owner/events/:id/itinerary */
export const replaceItinerary = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.items)) throw new BadRequestError("items must be an array");

    const items = body.items.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        return {
            staffId: present(item.staffId)
                ? requireIdParam(String(item.staffId), `items[${index}].staffId`)
                : null,
            sequence: requireInteger(item.sequence, `items[${index}].sequence`),
            from: requireString(item.from, `items[${index}].from`, 160),
            to: requireString(item.to, `items[${index}].to`, 160),
            departAt: requireDateTimeString(
                item.departAt,
                `items[${index}].departAt`
            ),
            arriveAt: requireDateTimeString(
                item.arriveAt,
                `items[${index}].arriveAt`
            ),
            mode: requireString(item.mode ?? "other", `items[${index}].mode`, 20),
            notes: optionalString(item.notes, `items[${index}].notes`, 255),
        };
    });

    const data = await eventService.replaceItinerary(
        requireIdParam(req.params.id),
        items
    );
    res.status(200).json({ success: true, data });
});

// --- Event supplies ---

/** PUT /api/owner/events/:id/supplies */
export const replaceSupplies = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.items)) throw new BadRequestError("items must be an array");

    const items = body.items.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        return {
            supplyId: requireIdParam(
                String(item.supplyId ?? ""),
                `items[${index}].supplyId`
            ),
            plannedQuantity: requireNumber(
                item.plannedQuantity,
                `items[${index}].plannedQuantity`
            ),
        };
    });

    const data = await eventService.replaceEventSupplies(
        requireIdParam(req.params.id),
        items
    );
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/events/:id/supplies/issue */
export const issueSupplies = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const data = await eventService.issueEventSupplies(
        requireIdParam(req.params.id),
        req.user.id
    );
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/events/:id/supplies/settle */
export const settleSupplies = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.items)) throw new BadRequestError("items must be an array");

    const items = body.items.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        return {
            supplyId: requireIdParam(
                String(item.supplyId ?? ""),
                `items[${index}].supplyId`
            ),
            consumedQuantity: requireNumber(
                item.consumedQuantity ?? 0,
                `items[${index}].consumedQuantity`
            ),
            returnedQuantity: requireNumber(
                item.returnedQuantity ?? 0,
                `items[${index}].returnedQuantity`
            ),
        };
    });

    const data = await eventService.settleEventSupplies(
        requireIdParam(req.params.id),
        items,
        req.user.id
    );
    res.status(200).json({ success: true, data });
});

// --- Staff portal ---

/** GET /api/staff/events?from=&to= */
export const listMyEvents = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");

    const now = new Date();
    const from = present(req.query.from)
        ? combineDateTime(requireDateString(req.query.from, "from"), "00:00:00")
        : startOfDay(now);
    const to = present(req.query.to)
        ? endOfDay(combineDateTime(requireDateString(req.query.to, "to"), "00:00:00"))
        : endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30));

    const data = await eventService.listEventsForStaffUser(req.user.id, from, to);
    res.status(200).json({ success: true, data });
});
