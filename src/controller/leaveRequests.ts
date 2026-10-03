import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalInteger,
    optionalString,
    requireDateString,
    requireIdParam,
    requireString,
} from "../helper/validation.js";
import * as leaveRequestsService from "../service/leaveRequests.js";

// Types
import type { LeaveRequestStatus } from "../constant/leaveRequests.js";
import { LEAVE_REQUEST_STATUSES } from "../constant/leaveRequests.js";

/** Reads a `?status=` filter, defaulting to "all requests". */
const parseStatus = (value: unknown): LeaveRequestStatus | null => {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const text = requireString(value, "status", 20);

    if (!(LEAVE_REQUEST_STATUSES as readonly string[]).includes(text)) {
        throw new BadRequestError(
            `status must be one of ${LEAVE_REQUEST_STATUSES.join(", ")}`
        );
    }

    return text as LeaveRequestStatus;
};

/** Reads the optional decision note shared by reject/cancel. */
const parseNote = (body: Record<string, unknown>): string | null =>
    optionalString(body.reason ?? body.note, "reason", 255);

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** First and last `YYYY-MM-DD` of a `YYYY-MM` month. */
const monthBounds = (month: string): { from: string; to: string } => {
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5, 7)) - 1;
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return { from: `${month}-01`, to: `${month}-${pad2(lastDay)}` };
};

/** The current local month as `YYYY-MM`. */
const currentMonth = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
};

/** Longest accepted coverage window — a little over a year. */
const MAX_COVERAGE_DAYS = 366;

/**
 * GET /api/staff/leave-requests/coverage?from=&to=
 *
 * Pending/approved leave for **every** staff member overlapping the range,
 * so the request-leave calendar can tint days another colleague is already
 * off. Both dates are optional and default to the current month.
 */
export const coverage = asyncHandler(async (req, res) => {
    const defaults = monthBounds(currentMonth());
    const from = req.query.from
        ? requireDateString(req.query.from, "from")
        : defaults.from;
    const to = req.query.to ? requireDateString(req.query.to, "to") : defaults.to;

    if (to < from) {
        throw new BadRequestError("to must be on or after from");
    }

    const spanDays = Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
    );
    if (spanDays > MAX_COVERAGE_DAYS) {
        throw new BadRequestError(
            `coverage range cannot exceed ${MAX_COVERAGE_DAYS} days`
        );
    }

    const data = await leaveRequestsService.listCoverage(from, to);
    res.status(200).json({ success: true, data });
});

// --- Staff ---

/** GET /api/staff/leave-requests — the caller's own requests. */
export const listMine = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const data = await leaveRequestsService.listForStaffUser(req.user.id);
    res.status(200).json({ success: true, data });
});

/** POST /api/staff/leave-requests  { startDate, endDate, reason? } */
export const createMine = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await leaveRequestsService.createForStaffUser(req.user.id, {
        startDate: requireDateString(body.startDate, "startDate"),
        endDate: requireDateString(body.endDate, "endDate"),
        reason: optionalString(body.reason, "reason", 255),
    });

    res.status(201).json({ success: true, data });
});

/** PATCH /api/staff/leave-requests/:id/cancel — withdraw a pending request. */
export const cancelMine = asyncHandler(async (req, res) => {
    if (!req.user) {
        throw new UnauthorizedError("Authentication required");
    }

    const data = await leaveRequestsService.cancelOwn(
        req.user.id,
        requireIdParam(req.params.id)
    );
    res.status(200).json({ success: true, data });
});

// --- Owner ---

/** GET /api/owner/leave-requests?status=&staffId= */
export const listAll = asyncHandler(async (req, res) => {
    const data = await leaveRequestsService.listAll(
        parseStatus(req.query.status),
        optionalInteger(req.query.staffId, "staffId")
    );
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/leave-requests/:id/conflicts — appointments in the period. */
export const getConflicts = asyncHandler(async (req, res) => {
    const appointments = await leaveRequestsService.getConflicts(
        requireIdParam(req.params.id)
    );
    res.status(200).json({ success: true, data: appointments });
});

/**
 * POST /api/owner/leave-requests/:id/approve  { force? }
 *
 * Responds 409 with the overlapping appointments unless the caller has
 * reviewed them and passes `force: true`.
 */
export const approve = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await leaveRequestsService.approve(requireIdParam(req.params.id), {
        decidedBy: req.user?.id ?? null,
        force: body.force === true,
    });
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/leave-requests/:id/reject  { reason? } */
export const reject = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await leaveRequestsService.reject(requireIdParam(req.params.id), {
        decidedBy: req.user?.id ?? null,
        note: parseNote(body),
    });
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/leave-requests/:id/cancel  { reason? } — undo approved leave. */
export const cancelApproved = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await leaveRequestsService.cancelApproved(requireIdParam(req.params.id), {
        decidedBy: req.user?.id ?? null,
        note: parseNote(body),
    });
    res.status(200).json({ success: true, data });
});
