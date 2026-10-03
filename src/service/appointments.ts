import type { PoolConnection } from "mysql2/promise";
import AppointmentModel from "../model/appointments.js";
import ServiceModel from "../model/services.js";
import StaffModel from "../model/staff.js";
import { createBooking } from "./booking.js";
import { getAvailability } from "./availability.js";
import { createTransactionForAppointment } from "./transactions.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { addMinutes, formatDate, formatTime } from "../helper/time.js";
import { BOOKING_RULES } from "../config/booking.js";
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    SlotConflictError,
    isDuplicateKeyError,
} from "../helper/error.js";
import { canTransition, isActiveStatus, statusLabel } from "../constant/appointments.js";

// Types
import type { BookingCustomer } from "./booking.js";
import type {
    AppointmentFilter,
    AppointmentStatus,
    ManagedAppointmentRow,
} from "../model/appointments.js";
import type { PaymentStatus } from "../model/transactions.js";

/** Owner/staff-facing appointment shape (camelCase, no secrets). */
export interface AppointmentDetail {
    id: number;
    reference: string;
    status: AppointmentStatus;
    /** Payment status of the linked transaction (null before completion). */
    paymentStatus: PaymentStatus | null;
    source: "online" | "manual";
    startAt: Date;
    endAt: Date;
    price: number;
    notes: string | null;
    customer: {
        id: number;
        name: string;
        phone: string | null;
        email: string | null;
    };
    staff: { id: number; name: string };
    service: { id: number; name: string; durationMinutes: number };
    createdAt: Date;
    updatedAt: Date | null;
}

const fullName = (first: string, last: string | null): string =>
    [first, last].filter(Boolean).join(" ").trim();

const toDetail = (row: ManagedAppointmentRow): AppointmentDetail => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    paymentStatus: row.payment_status,
    source: row.source,
    startAt: row.start_at,
    endAt: row.end_at,
    price: row.price,
    notes: row.notes,
    customer: {
        id: row.customer_id,
        name: fullName(row.customer_first_name, row.customer_last_name),
        phone: row.customer_phone,
        email: row.customer_email,
    },
    staff: {
        id: row.staff_id,
        name: fullName(row.staff_first_name, row.staff_last_name),
    },
    service: {
        id: row.service_id,
        name: row.service_name,
        durationMinutes: row.service_duration_minutes,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

/** Owner appointment list. All filters optional. */
export const listAppointments = (
    filter: AppointmentFilter
): Promise<AppointmentDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new AppointmentModel(connection).listAppointments(filter);
        return rows.map(toDetail);
    });

/** Single appointment with joined details. */
export const getAppointment = (id: number): Promise<AppointmentDetail> =>
    withConnection(async (connection) => {
        const row = await new AppointmentModel(connection).findByIdWithDetails(id);
        if (!row) {
            throw new NotFoundError("Appointment not found", 404);
        }
        return toDetail(row);
    });

/**
 * Active appointments overlapping a time range — used to warn when
 * blocking time (leave/closure) over existing bookings.
 * `staffId` null = any staff (salon-wide closures).
 */
export const listConflictingAppointments = (
    from: Date,
    to: Date,
    staffId: number | null
): Promise<AppointmentDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new AppointmentModel(connection).listOverlapping(from, to, staffId);
        return rows.map(toDetail);
    });

export interface ChangeStatusOptions {
    reason?: string | null;
}

/**
 * Moves an appointment through the status workflow (FR-AP3).
 *
 * Only transitions in `STATUS_TRANSITIONS` are accepted; finished appointments
 * (completed / cancelled / no-show) are terminal.
 *
 * When the appointment is marked `completed`, a billing transaction record is
 * automatically created (Phase 8). The transaction is created after the status
 * update so that a failure in billing does NOT roll back the completion —
 * the owner can still update the transaction separately.
 */
export const changeStatus = async (
    id: number,
    status: AppointmentStatus,
    options: ChangeStatusOptions = {}
): Promise<AppointmentDetail> => {
    const detail = await withConnection(async (connection) => {
        const model = new AppointmentModel(connection);
        const row = await model.findById(id);

        if (!row) {
            throw new NotFoundError("Appointment not found", 404);
        }

        if (row.status === status) {
            throw new BadRequestError(
                `This appointment is already marked as ${statusLabel(status)}.`
            );
        }

        if (!canTransition(row.status, status)) {
            throw new ConflictError(
                `A ${statusLabel(row.status)} appointment cannot be changed to ${statusLabel(
                    status
                )}.`
            );
        }

        await model.updateStatus(id, status, { reason: options.reason ?? null });
        return toDetail((await model.findByIdWithDetails(id))!);
    });

    // Auto-create billing transaction when completing an appointment.
    // Runs outside the status-update connection so billing failures are isolated.
    if (status === "completed") {
        try {
            await createTransactionForAppointment({
                appointmentId: detail.id,
                customerId: detail.customer.id,
                staffId: detail.staff.id,
                serviceId: detail.service.id,
                price: detail.price,
                completedAt: new Date(),
            });
        } catch {
            // Transaction creation is best-effort; do not surface billing errors
            // to the status-change response. The owner can create/fix it manually.
        }
    }

    return detail;
};

/** Statuses a staff member may move an appointment to. */
const STAFF_STATUSES: AppointmentStatus[] = ["confirmed", "completed"];

/**
 * Staff-side status change (FR-AP5).
 *
 * The appointment must belong to the caller (404 otherwise) and staff
 * may only **confirm** or **complete** — cancels, no-shows, reschedules
 * and edits stay with the owner. Completion still auto-creates the
 * billing transaction via `changeStatus`.
 */
export const changeStatusForStaffUser = async (
    userId: number,
    id: number,
    status: AppointmentStatus,
    options: ChangeStatusOptions = {}
): Promise<AppointmentDetail> => {
    // 404 unless the appointment belongs to this staff member.
    await getAppointmentForStaffUser(userId, id);

    if (!STAFF_STATUSES.includes(status)) {
        throw new BadRequestError(
            "Staff can only confirm or complete an appointment."
        );
    }

    return changeStatus(id, status, options);
};

/**
 * Re-checks a schedule change against live availability and applies it.
 *
 * Enforces the same rules as online booking (working hours, exceptions, buffer,
 * lead time, eligibility) while **excluding the appointment itself** from the
 * busy set, so moving a booking forward does not collide with its old time.
 * A taken slot throws a `SlotConflictError` carrying alternative start times.
 */
const applyScheduleChange = async (
    connection: PoolConnection,
    row: ManagedAppointmentRow,
    target: { serviceId: number; staffId: number; startAt: Date },
    now: Date
): Promise<void> => {
    const model = new AppointmentModel(connection);

    const service = await new ServiceModel(connection).findById(target.serviceId);
    if (!service || service.is_active !== 1) {
        throw new NotFoundError("The selected service is not available", 404);
    }

    // Validates the staff member is active and eligible for the service too.
    const availability = await getAvailability({
        serviceId: service.id,
        date: formatDate(target.startAt),
        staffId: target.staffId,
        excludeAppointmentId: row.id,
        now,
    });

    const requested = formatTime(target.startAt);
    const entry = availability.staff.find((member) => member.staffId === target.staffId);
    const allowed = entry?.slots.includes(requested) ?? false;

    if (!allowed) {
        const alternatives = (entry?.slots ?? [])
            .filter((slot) => slot !== requested)
            .slice(0, BOOKING_RULES.alternativeSlotCount);

        throw new SlotConflictError(
            "That time is not available for the selected staff member. Please choose another slot.",
            alternatives
        );
    }

    const endAt = addMinutes(target.startAt, service.duration_minutes);
    const bufferEndAt = addMinutes(endAt, BOOKING_RULES.bufferMinutes);

    // Serialize with other bookings for the target staff member.
    await model.lockStaffRow(target.staffId);

    const clash = await model.findOverlap(
        target.staffId,
        target.startAt,
        bufferEndAt,
        row.id
    );
    if (clash) {
        throw new ConflictError("That time was just taken. Please choose another slot.");
    }

    try {
        await model.updateSchedule(row.id, {
            staffId: target.staffId,
            serviceId: service.id,
            startAt: target.startAt,
            endAt,
            bufferEndAt,
            price: service.price,
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            throw new ConflictError("That time was just taken. Please choose another slot.");
        }
        throw err;
    }
};

export interface RescheduleInput {
    startAt: Date;
    /** Defaults to the appointment's current staff member. */
    staffId?: number | null;
    now?: Date;
}

/** Moves an active appointment to a new time (optionally a different staff member). */
export const rescheduleAppointment = (
    id: number,
    input: RescheduleInput
): Promise<AppointmentDetail> =>
    withTransaction(async (connection) => {
        const now = input.now ?? new Date();
        const model = new AppointmentModel(connection);
        const row = await model.findByIdWithDetails(id);

        if (!row) {
            throw new NotFoundError("Appointment not found", 404);
        }
        if (!isActiveStatus(row.status)) {
            throw new ConflictError(
                "Only pending or confirmed appointments can be rescheduled. " +
                    "Please reopen the booking by creating a new one."
            );
        }

        await applyScheduleChange(
            connection,
            row,
            {
                serviceId: row.service_id,
                staffId: input.staffId ?? row.staff_id,
                startAt: input.startAt,
            },
            now
        );

        return toDetail((await model.findByIdWithDetails(id))!);
    });

export interface UpdateAppointmentInput {
    notes?: string | null | undefined;
    serviceId?: number | null | undefined;
    staffId?: number | null | undefined;
    startAt?: Date | null | undefined;
    now?: Date;
}

/**
 * Updates an appointment's notes and/or its schedule (service, staff, time).
 * Any schedule change is re-checked exactly like a reschedule.
 */
export const updateAppointment = (
    id: number,
    input: UpdateAppointmentInput
): Promise<AppointmentDetail> =>
    withTransaction(async (connection) => {
        const now = input.now ?? new Date();
        const model = new AppointmentModel(connection);
        const row = await model.findByIdWithDetails(id);

        if (!row) {
            throw new NotFoundError("Appointment not found", 404);
        }

        if (input.notes !== undefined) {
            await model.updateNotes(id, input.notes);
        }

        const serviceId = input.serviceId ?? row.service_id;
        const staffId = input.staffId ?? row.staff_id;
        const startAt = input.startAt ?? row.start_at;

        const scheduleChanged =
            serviceId !== row.service_id ||
            staffId !== row.staff_id ||
            startAt.getTime() !== row.start_at.getTime();

        if (scheduleChanged) {
            if (!isActiveStatus(row.status)) {
                throw new ConflictError(
                    "Only pending or confirmed appointments can be rescheduled."
                );
            }

            await applyScheduleChange(connection, row, { serviceId, staffId, startAt }, now);
        }

        return toDetail((await model.findByIdWithDetails(id))!);
    });

export interface ManualBookingInput {
    customer: BookingCustomer;
    staffId: number;
    serviceId: number;
    startAt: Date;
    notes?: string | null;
    createdBy: number | null;
}

/**
 * Owner-created manual (walk-in / phone) booking (FR-AP4).
 *
 * The backend re-checks the slot before inserting: the staff member must be
 * active, eligible for the service, scheduled to work at that time (working
 * hours / no leave or closure), and conflict-free. The online lead time and
 * advance-booking window are intentionally **not** enforced, so the owner can
 * still record a same-day walk-in. All checks run inside one transaction with a
 * staff-row lock, so the slot cannot be double-booked.
 */
export const createManualBooking = async (
    input: ManualBookingInput
): Promise<AppointmentDetail> => {
    const created = await createBooking({
        customer: input.customer,
        staffId: input.staffId,
        serviceId: input.serviceId,
        startAt: input.startAt,
        source: "manual",
        createdBy: input.createdBy,
        enforceSchedule: true,
    });

    if (input.notes) {
        await withConnection((connection) =>
            new AppointmentModel(connection).updateNotes(created.id, input.notes!)
        );
    }

    return getAppointment(created.id);
};

// --- Staff self-service (FR-AP5: staff see only their own appointments) ---

/** The staff row linked to a login user, or null. */
export const findStaffForUser = (userId: number) =>
    withConnection((connection) => new StaffModel(connection).findByUserId(userId));

/** Appointments belonging to one staff member (by login user id). */
export const listAppointmentsForStaffUser = async (
    userId: number,
    filter: AppointmentFilter
): Promise<AppointmentDetail[]> => {
    const staff = await findStaffForUser(userId);

    // A staff account without a staff profile simply has no appointments.
    if (!staff) {
        return [];
    }

    const scoped: AppointmentFilter = { ...filter, staffId: staff.id };
    return listAppointments(scoped);
};

/** A single appointment, but only when it belongs to the requesting staff member. */
export const getAppointmentForStaffUser = async (
    userId: number,
    id: number
): Promise<AppointmentDetail> => {
    const staff = await findStaffForUser(userId);
    const appointment = await getAppointment(id);

    // Never reveal another staff member's appointment.
    if (!staff || appointment.staff.id !== staff.id) {
        throw new NotFoundError("Appointment not found", 404);
    }

    return appointment;
};
