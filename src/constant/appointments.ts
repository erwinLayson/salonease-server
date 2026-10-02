import type { AppointmentStatus } from "../model/appointments.js";

/** The five appointment statuses (FR-AP3). */
export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
    "pending",
    "confirmed",
    "completed",
    "cancelled",
    "no_show",
];

/** Statuses that still occupy a slot and can be rescheduled/cancelled. */
export const ACTIVE_STATUSES: AppointmentStatus[] = ["pending", "confirmed"];

/**
 * Allowed status transitions.
 *
 * Owner dashboard actions map onto these:
 *   confirm  → confirmed
 *   complete → completed
 *   cancel   → cancelled
 *   no-show  → no_show
 *
 * `completed`, `cancelled`, and `no_show` are terminal: once an appointment is
 * finished it is history and must not be reopened.
 */
export const STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
    pending: ["confirmed", "cancelled", "no_show"],
    confirmed: ["completed", "cancelled", "no_show"],
    completed: [],
    cancelled: [],
    no_show: [],
};

/** True when moving from `from` to `to` is allowed. */
export const canTransition = (from: AppointmentStatus, to: AppointmentStatus): boolean =>
    STATUS_TRANSITIONS[from].includes(to);

/** True when the status still holds its slot. */
export const isActiveStatus = (status: AppointmentStatus): boolean =>
    ACTIVE_STATUSES.includes(status);

/** Human-readable label for error messages. */
export const statusLabel = (status: AppointmentStatus): string => status.replace(/_/g, " ");
