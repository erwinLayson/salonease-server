import LeaveRequestModel from "../model/leaveRequests.js";
import StaffModel from "../model/staff.js";
import SchedulingModel from "../model/scheduling.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { combineDateTime, formatDate, startOfDay } from "../helper/time.js";
import {
    AppointmentConflictError,
    BadRequestError,
    ConflictError,
    NotFoundError,
} from "../helper/error.js";
import { findStaffForUser, listConflictingAppointments } from "./appointments.js";
import { canTransitionLeave } from "../constant/leaveRequests.js";

// Types
import type { AppointmentDetail } from "./appointments.js";
import type {
    LeaveCoverage,
    LeaveRequestDetail,
    LeaveRequestRow,
    LeaveRequestStatus,
} from "../constant/leaveRequests.js";

/** Owner/staff-facing submission payload (dates already validated as `YYYY-MM-DD`). */
export interface LeaveRequestDraft {
    startDate: string;
    endDate: string;
    reason: string | null;
}

const fullName = (first: string, last: string | null): string =>
    [first, last].filter(Boolean).join(" ").trim();

/** `YYYY-MM-DD` from a DATE value (mysql2 may hand back a Date or a string). */
const dateKey = (value: Date | string): string =>
    typeof value === "string" ? value.slice(0, 10) : formatDate(value);

/** Inclusive day count between two `YYYY-MM-DD` dates. */
export const countLeaveDays = (startDate: string, endDate: string): number =>
    Math.round(
        (new Date(`${endDate}T00:00:00`).getTime() -
            new Date(`${startDate}T00:00:00`).getTime()) /
            86_400_000
    ) + 1;

/** Start of the covered period (local midnight of the start date). */
const leaveStart = (row: LeaveRequestRow): Date =>
    combineDateTime(dateKey(row.start_date), "00:00:00");

/** End of the covered period (last second of the end date). */
const leaveEnd = (row: LeaveRequestRow): Date =>
    combineDateTime(dateKey(row.end_date), "23:59:59");

const toDetail = (row: LeaveRequestRow): LeaveRequestDetail => ({
    id: row.id,
    staffId: row.staff_id,
    staffName: fullName(row.staff_first_name, row.staff_last_name),
    startDate: dateKey(row.start_date),
    endDate: dateKey(row.end_date),
    days: countLeaveDays(dateKey(row.start_date), dateKey(row.end_date)),
    reason: row.reason,
    status: row.status,
    decisionNote: row.decision_note,
    decidedAt: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    requestedAt: new Date(row.created_at).toISOString(),
});

/** Validates the requested range: well-ordered and not in the past. */
const validateRange = (startDate: string, endDate: string): void => {
    if (endDate < startDate) {
        throw new BadRequestError("endDate must be on or after startDate");
    }

    if (startDate < formatDate(startOfDay(new Date()))) {
        throw new BadRequestError("Leave dates cannot be in the past");
    }
};

const findRequest = (id: number): Promise<LeaveRequestRow | null> =>
    withConnection((connection) => new LeaveRequestModel(connection).findById(id));

const requireRequest = async (id: number): Promise<LeaveRequestRow> => {
    const row = await findRequest(id);
    if (!row) {
        throw new NotFoundError("Leave request not found", 404);
    }
    return row;
};

// --- Staff self-service ---

/**
 * Submits a leave request for the signed-in staff member.
 *
 * The request starts as `pending` and therefore does **not** change
 * availability — only an approval materialises a blocking exception.
 */
export const createForStaffUser = (
    userId: number,
    draft: LeaveRequestDraft
): Promise<LeaveRequestDetail> =>
    withConnection(async (connection) => {
        const staff = await new StaffModel(connection).findByUserId(userId);

        if (!staff) {
            throw new NotFoundError("Staff profile not found", 404);
        }
        if (staff.is_active !== 1) {
            throw new BadRequestError(
                "Your staff profile is inactive, so leave cannot be requested."
            );
        }

        validateRange(draft.startDate, draft.endDate);

        const model = new LeaveRequestModel(connection);
        const overlap = await model.findApprovedOverlap(
            staff.id,
            draft.startDate,
            draft.endDate
        );

        if (overlap) {
            throw new ConflictError(
                `You already have approved leave from ${dateKey(overlap.start_date)} to ` +
                    `${dateKey(overlap.end_date)} that overlaps these dates.`
            );
        }

        const id = await model.create({ staffId: staff.id, ...draft });
        return toDetail((await model.findById(id))!);
    });

/** The signed-in staff member's own requests, newest first. */
export const listForStaffUser = async (userId: number): Promise<LeaveRequestDetail[]> => {
    const staff = await findStaffForUser(userId);

    // A staff account without a staff profile simply has no leave requests.
    if (!staff) {
        return [];
    }

    const rows = await withConnection((connection) =>
        new LeaveRequestModel(connection).listByStaff(staff.id)
    );
    return rows.map(toDetail);
};

/**
 * Whose leave (pending or approved) overlaps `[from, to]` — the overlay the
 * request-leave calendar tints day by day, so staff can coordinate dates.
 *
 * Any signed-in staff member may read it; it carries names, dates and status
 * only — never reasons or decision notes, which belong to the requester and
 * the owner.
 */
export const listCoverage = (from: string, to: string): Promise<LeaveCoverage[]> =>
    withConnection(async (connection) => {
        const rows = await new LeaveRequestModel(connection).listCoverage(from, to);
        return rows.map((row) => ({
            id: row.id,
            staffId: row.staff_id,
            staffName: fullName(row.staff_first_name, row.staff_last_name),
            startDate: dateKey(row.start_date),
            endDate: dateKey(row.end_date),
            status: row.status,
        }));
    });

/** Withdraws one of the caller's own requests while it is still pending. */
export const cancelOwn = (
    userId: number,
    id: number
): Promise<LeaveRequestDetail> =>
    withConnection(async (connection) => {
        const staff = await new StaffModel(connection).findByUserId(userId);
        const model = new LeaveRequestModel(connection);
        const row = await model.findById(id);

        // Never reveal another staff member's request.
        if (!staff || !row || row.staff_id !== staff.id) {
            throw new NotFoundError("Leave request not found", 404);
        }

        if (row.status !== "pending") {
            throw new ConflictError(
                `Only pending requests can be withdrawn — this one is ${row.status}. ` +
                    "Ask the owner to cancel an approved leave."
            );
        }

        await model.applyDecision(id, {
            status: "cancelled",
            decisionNote: null,
            decidedBy: userId,
            decidedAt: new Date(),
            exceptionId: null,
        });

        return toDetail((await model.findById(id))!);
    });

// --- Owner management ---

/** Every leave request, optionally filtered by status and/or staff. */
export const listAll = (
    status: LeaveRequestStatus | null,
    staffId: number | null
): Promise<LeaveRequestDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new LeaveRequestModel(connection).listAll(status, staffId);
        return rows.map(toDetail);
    });

/** Active appointments overlapping the requested leave period. */
export const getConflicts = async (id: number): Promise<AppointmentDetail[]> => {
    const row = await requireRequest(id);
    return listConflictingAppointments(leaveStart(row), leaveEnd(row), row.staff_id);
};

/**
 * Approves a pending request.
 *
 * The approval is atomic: a blocking `schedule_exceptions` row (type `leave`)
 * is created and the request is marked `approved` in one transaction, so the
 * availability engine, the booking back-check and the walk-in wizard all start
 * honouring the leave immediately.
 *
 * Existing appointments are never modified. If any overlap the period the
 * caller must review them first and retry with `force`, which surfaces them as
 * a 409 with the conflicting appointments attached.
 */
export const approve = (
    id: number,
    options: { decidedBy: number | null; force?: boolean }
): Promise<LeaveRequestDetail> =>
    withTransaction(async (connection) => {
        const model = new LeaveRequestModel(connection);
        const row = await model.findById(id);

        if (!row) {
            throw new NotFoundError("Leave request not found", 404);
        }
        if (!canTransitionLeave(row.status, "approved")) {
            throw new ConflictError(
                `Only pending requests can be approved — this one is ${row.status}.`
            );
        }

        const staff = await new StaffModel(connection).findById(row.staff_id);
        if (!staff) {
            throw new NotFoundError("Staff not found", 404);
        }
        if (staff.is_active !== 1) {
            throw new BadRequestError(
                `${fullName(staff.first_name, staff.last_name)} is no longer an active staff member.`
            );
        }

        const startDate = dateKey(row.start_date);
        const endDate = dateKey(row.end_date);

        const overlap = await model.findApprovedOverlap(staff.id, startDate, endDate, id);
        if (overlap) {
            throw new ConflictError(
                `${fullName(staff.first_name, staff.last_name)} already has approved leave from ` +
                    `${dateKey(overlap.start_date)} to ${dateKey(overlap.end_date)} that overlaps these dates.`
            );
        }

        if (!options.force) {
            const conflicts = await listConflictingAppointments(
                leaveStart(row),
                leaveEnd(row),
                staff.id
            );
            if (conflicts.length > 0) {
                const count = conflicts.length;
                throw new AppointmentConflictError(
                    `${count} active appointment${count === 1 ? "" : "s"} overlap these leave dates. ` +
                        "Review them with the staff member before approving.",
                    conflicts
                );
            }
        }

        const exceptionId = await new SchedulingModel(connection).createException({
            staffId: staff.id,
            type: "leave",
            startAt: leaveStart(row),
            endAt: leaveEnd(row),
            reason: row.reason,
            createdBy: options.decidedBy,
        });

        await model.applyDecision(id, {
            status: "approved",
            decisionNote: null,
            decidedBy: options.decidedBy,
            decidedAt: new Date(),
            exceptionId,
        });

        return toDetail((await model.findById(id))!);
    });

/** Rejects a pending request, with an optional reason for the staff member. */
export const reject = (
    id: number,
    options: { decidedBy: number | null; note: string | null }
): Promise<LeaveRequestDetail> =>
    withConnection(async (connection) => {
        const model = new LeaveRequestModel(connection);
        const row = await model.findById(id);

        if (!row) {
            throw new NotFoundError("Leave request not found", 404);
        }
        if (!canTransitionLeave(row.status, "rejected")) {
            throw new ConflictError(
                `Only pending requests can be rejected — this one is ${row.status}.`
            );
        }

        await model.applyDecision(id, {
            status: "rejected",
            decisionNote: options.note,
            decidedBy: options.decidedBy,
            decidedAt: new Date(),
            exceptionId: null,
        });

        return toDetail((await model.findById(id))!);
    });

/**
 * Undoes an approved leave: removes the blocking exception and marks the
 * request `cancelled`, making the dates bookable again.
 */
export const cancelApproved = (
    id: number,
    options: { decidedBy: number | null; note: string | null }
): Promise<LeaveRequestDetail> =>
    withTransaction(async (connection) => {
        const model = new LeaveRequestModel(connection);
        const row = await model.findById(id);

        if (!row) {
            throw new NotFoundError("Leave request not found", 404);
        }
        if (!canTransitionLeave(row.status, "cancelled") || row.status !== "approved") {
            throw new ConflictError(
                `Only approved leave can be cancelled — this request is ${row.status}.`
            );
        }

        if (row.exception_id !== null) {
            await new SchedulingModel(connection).deleteException(row.exception_id);
        }

        await model.applyDecision(id, {
            status: "cancelled",
            decisionNote: options.note,
            decidedBy: options.decidedBy,
            decidedAt: new Date(),
            exceptionId: null,
        });

        return toDetail((await model.findById(id))!);
    });
