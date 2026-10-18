import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalInteger,
    optionalPhone,
    optionalString,
    requireDateString,
    requireDateTimeString,
    requireIdParam,
    requireString,
} from "../helper/validation.js";
import { formatDate } from "../helper/time.js";
import { QUEUE_STATUSES } from "../constant/queue.js";
import * as queueService from "../service/queue.js";

// Types
import type { QueueStatus } from "../constant/queue.js";

const parseQueueDate = (value: unknown): string =>
    value === undefined || value === null || value === ""
        ? formatDate(new Date())
        : requireDateString(value, "date");

const parseStatus = (value: unknown): QueueStatus => {
    const status = requireString(value, "status", 20);
    if (!QUEUE_STATUSES.includes(status as QueueStatus)) {
        throw new BadRequestError(`status must be one of: ${QUEUE_STATUSES.join(", ")}`);
    }
    return status as QueueStatus;
};

/** GET /api/owner/queue?date=YYYY-MM-DD */
export const listQueue = asyncHandler(async (req, res) => {
    const data = await queueService.listQueue(parseQueueDate(req.query.date));
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/queue/:id */
export const getTicket = asyncHandler(async (req, res) => {
    const data = await queueService.getTicket(requireIdParam(req.params.id));
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/queue */
export const createTicket = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");

    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await queueService.createTicket({
        date:
            body.date === undefined || body.date === null || body.date === ""
                ? undefined
                : requireDateString(body.date, "date"),
        customerName: requireString(body.customerName, "customerName", 160),
        customerPhone: optionalPhone(body.customerPhone, "customerPhone"),
        serviceId: requireIdParam(String(body.serviceId ?? ""), "serviceId"),
        preferredStaffId: optionalInteger(body.preferredStaffId, "preferredStaffId"),
        assignedStaffId: optionalInteger(body.assignedStaffId, "assignedStaffId"),
        notes: optionalString(body.notes, "notes", 255),
        createdBy: req.user.id,
    });

    res.status(201).json({ success: true, data });
});

/** PATCH /api/owner/queue/:id/status  { status, assignedStaffId? } */
export const changeStatus = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await queueService.changeQueueStatus(
        requireIdParam(req.params.id),
        {
            status: parseStatus(body.status),
            assignedStaffId:
                body.assignedStaffId === undefined
                    ? undefined
                    : optionalInteger(body.assignedStaffId, "assignedStaffId"),
        }
    );
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/queue/:id/convert  { staffId, startAt } */
export const convertTicket = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const data = await queueService.convertTicket(requireIdParam(req.params.id), {
        staffId: requireIdParam(String(body.staffId ?? ""), "staffId"),
        startAt: requireDateTimeString(body.startAt, "startAt"),
        createdBy: req.user.id,
    });

    res.status(200).json({ success: true, data });
});

/** GET /api/owner/queue/:id/assignment-check?staffId= */
export const checkAssignment = asyncHandler(async (req, res) => {
    const staffId = optionalInteger(req.query.staffId, "staffId");
    if (!staffId) throw new BadRequestError("staffId is required");

    const data = await queueService.checkAssignment(
        requireIdParam(req.params.id),
        staffId
    );
    res.status(200).json({ success: true, data });
});
