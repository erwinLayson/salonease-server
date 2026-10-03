/** The four leave-request statuses. */
export const LEAVE_REQUEST_STATUSES = [
    "pending",
    "approved",
    "rejected",
    "cancelled",
] as const;

export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

/**
 * Allowed status transitions.
 *
 *   pending  -> approved | rejected | cancelled
 *   approved -> cancelled (the owner undoes an approved leave)
 *   rejected, cancelled are terminal.
 *
 * Only `approved` materialises a `schedule_exceptions` row, so every other
 * status leaves staff availability untouched.
 */
export const LEAVE_STATUS_TRANSITIONS: Record<LeaveRequestStatus, LeaveRequestStatus[]> = {
    pending: ["approved", "rejected", "cancelled"],
    approved: ["cancelled"],
    rejected: [],
    cancelled: [],
};

/** True when moving from `from` to `to` is allowed. */
export const canTransitionLeave = (
    from: LeaveRequestStatus,
    to: LeaveRequestStatus
): boolean => LEAVE_STATUS_TRANSITIONS[from].includes(to);

/** A row from `leave_requests`, joined with the staff member's name. */
export type LeaveRequestRow = {
    id: number;
    staff_id: number;
    start_date: Date | string;
    end_date: Date | string;
    reason: string | null;
    status: LeaveRequestStatus;
    decision_note: string | null;
    decided_by: number | null;
    decided_at: Date | string | null;
    exception_id: number | null;
    created_at: Date | string;
    staff_first_name: string;
    staff_last_name: string;
    staff_is_active: number;
};

/** Staff/owner-facing leave-request shape (camelCase, dates as `YYYY-MM-DD`). */
export interface LeaveRequestDetail {
    id: number;
    staffId: number;
    staffName: string;
    startDate: string;
    endDate: string;
    /** Inclusive day count (start date through end date). */
    days: number;
    reason: string | null;
    status: LeaveRequestStatus;
    decisionNote: string | null;
    decidedAt: string | null;
    requestedAt: string;
}

/** A new leave request submitted by a staff member. */
export interface CreateLeaveRequestInput {
    staffId: number;
    startDate: string;
    endDate: string;
    reason: string | null;
}

/** A row of the coverage query: names and dates only, never reasons. */
export type LeaveCoverageRow = {
    id: number;
    staff_id: number;
    start_date: Date | string;
    end_date: Date | string;
    status: LeaveRequestStatus;
    staff_first_name: string;
    staff_last_name: string;
};

/**
 * One staff member's pending/approved leave overlapping a queried range —
 * what the request-leave calendar tints day by day. Deliberately carries
 * no reason or decision note: it describes other people's requests.
 */
export interface LeaveCoverage {
    id: number;
    staffId: number;
    staffName: string;
    startDate: string;
    endDate: string;
    status: LeaveRequestStatus;
}
