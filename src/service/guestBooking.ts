import AppointmentModel from "../model/appointments.js";
import { createBooking } from "./booking.js";
import { getAvailability } from "./availability.js";
import { withConnection } from "../helper/withConnection.js";
import { addMinutes, formatDate, formatTime } from "../helper/time.js";
import { buildManageUrl } from "../config/app.js";
import { BOOKING_RULES } from "../config/booking.js";
import { ConflictError, NotFoundError } from "../helper/error.js";

// Types
import type { ManagedAppointmentRow } from "../model/appointments.js";
import type { StaffSlots } from "./availability.js";

export interface GuestContact {
    firstName: string;
    lastName: string | null;
    phone: string | null;
    email: string | null;
}

export interface GuestBookingInput {
    serviceId: number;
    /** null/undefined means "first available". */
    staffId?: number | null;
    startAt: Date;
    customer: GuestContact;
    now?: Date;
}

export interface GuestBookingSuccess {
    ok: true;
    appointment: AppointmentView;
    manageUrl: string;
}

export interface GuestBookingConflict {
    ok: false;
    message: string;
    alternatives: string[];
}

export type GuestBookingOutcome = GuestBookingSuccess | GuestBookingConflict;

/** Public, token-free shape returned to the customer. */
export interface AppointmentView {
    reference: string;
    status: string;
    startAt: Date;
    endAt: Date;
    serviceName: string;
    staffName: string;
    customerName: string;
    price: number;
    canCancel: boolean;
    canReschedule: boolean;
}

const toView = (row: ManagedAppointmentRow, now: Date): AppointmentView => {
    const cutoff = addMinutes(row.start_at, -BOOKING_RULES.cancellationCutoffMinutes);
    const isActive = row.status === "pending" || row.status === "confirmed";

    return {
        reference: row.reference,
        status: row.status,
        startAt: row.start_at,
        endAt: row.end_at,
        serviceName: row.service_name,
        staffName: `${row.staff_first_name} ${row.staff_last_name}`.trim(),
        customerName: [row.customer_first_name, row.customer_last_name]
            .filter(Boolean)
            .join(" ")
            .trim(),
        price: row.price,
        canCancel: isActive && now < cutoff,
        canReschedule: isActive,
    };
};

/** Unique alternative start times across staff, excluding the requested one. */
const collectAlternatives = (staff: StaffSlots[], requested: string): string[] => {
    const alternatives = new Set<string>();

    for (const member of staff) {
        for (const slot of member.slots) {
            if (slot !== requested) {
                alternatives.add(slot);
            }
        }
    }

    return [...alternatives].sort().slice(0, BOOKING_RULES.alternativeSlotCount);
};

/**
 * Creates a guest booking.
 *
 * Validates the requested slot against live availability (which enforces working
 * hours, eligibility, exceptions, buffer, and the lead time/window), picks the
 * chosen staff member or the first available one, then books atomically.
 * A taken slot returns conflicts plus nearby alternatives (FR-GB10).
 */
export const createGuestBooking = async (
    input: GuestBookingInput
): Promise<GuestBookingOutcome> => {
    const now = input.now ?? new Date();
    const date = formatDate(input.startAt);
    const requested = formatTime(input.startAt);

    const availability = await getAvailability({
        serviceId: input.serviceId,
        date,
        staffId: input.staffId ?? null,
        now,
    });

    const matches = availability.staff.filter((member) => member.slots.includes(requested));

    if (matches.length === 0) {
        return {
            ok: false,
            message:
                "That time is no longer available for the selected service. " +
                "Please choose another slot.",
            alternatives: collectAlternatives(availability.staff, requested),
        };
    }

    const chosen = matches[0]!;

    try {
        const created = await createBooking({
            customer: {
                firstName: input.customer.firstName,
                lastName: input.customer.lastName,
                phone: input.customer.phone,
                email: input.customer.email,
            },
            staffId: chosen.staffId,
            serviceId: input.serviceId,
            startAt: input.startAt,
            source: "online",
        });

        const view = await withConnection(async (connection) => {
            const row = await new AppointmentModel(connection).findManagedByToken(
                created.manage_token
            );
            return row!;
        });

        return {
            ok: true,
            appointment: toView(view, now),
            manageUrl: buildManageUrl(created.manage_token),
        };
    } catch (err) {
        // Lost a race for the slot between the availability check and the insert.
        if (err instanceof ConflictError) {
            return {
                ok: false,
                message:
                    "That time was just taken. Please choose another slot from the list.",
                alternatives: collectAlternatives(availability.staff, requested),
            };
        }
        throw err;
    }
};

/** Loads a booking by its manage token. */
export const getManagedBooking = async (
    token: string,
    now: Date = new Date()
): Promise<AppointmentView> => {
    const row = await withConnection((connection) =>
        new AppointmentModel(connection).findManagedByToken(token)
    );

    if (!row) {
        throw new NotFoundError("Booking not found", 404);
    }

    return toView(row, now);
};

/** Cancels a booking through its manage token, respecting the cutoff (CR-2). */
export const cancelManagedBooking = async (
    token: string,
    now: Date = new Date()
): Promise<AppointmentView> => {
    return withConnection(async (connection) => {
        const model = new AppointmentModel(connection);
        const row = await model.findManagedByToken(token);

        if (!row) {
            throw new NotFoundError("Booking not found", 404);
        }

        if (row.status !== "pending" && row.status !== "confirmed") {
            throw new ConflictError("This appointment can no longer be cancelled.");
        }

        const cutoff = addMinutes(row.start_at, -BOOKING_RULES.cancellationCutoffMinutes);
        if (now >= cutoff) {
            throw new ConflictError(
                `It is too late to cancel online (less than ${BOOKING_RULES.cancellationCutoffMinutes} ` +
                    "minutes before the appointment). Please contact the salon directly."
            );
        }

        await model.updateStatus(row.id, "cancelled", { reason: "Cancelled by customer" });
        return toView((await model.findManagedByToken(token))!, now);
    });
};

export interface RescheduleRequestInput {
    preferredStartAt?: Date | null;
    note?: string | null;
}

export interface RescheduleRequestResult {
    message: string;
    requestedAt: Date;
}

/**
 * Records a customer reschedule request on the appointment.
 *
 * Stored as a timestamped line in `appointments.notes` so the owner sees it in
 * the appointment view; Phase 8 turns this into an actual notification.
 */
export const requestReschedule = async (
    token: string,
    input: RescheduleRequestInput,
    now: Date = new Date()
): Promise<RescheduleRequestResult> => {
    return withConnection(async (connection) => {
        const model = new AppointmentModel(connection);
        const row = await model.findManagedByToken(token);

        if (!row) {
            throw new NotFoundError("Booking not found", 404);
        }

        if (row.status !== "pending" && row.status !== "confirmed") {
            throw new ConflictError(
                "This appointment can no longer be rescheduled. Please contact the salon."
            );
        }

        if (input.preferredStartAt && input.preferredStartAt <= now) {
            throw new ConflictError("The preferred new time must be in the future.");
        }

        const parts = [
            `[Reschedule requested ${formatDate(now)} ${formatTime(now)}]`,
            input.preferredStartAt
                ? `preferred: ${formatDate(input.preferredStartAt)} ${formatTime(input.preferredStartAt)}`
                : "preferred: any available time",
        ];
        if (input.note) {
            parts.push(`note: ${input.note}`);
        }

        await model.appendNote(row.id, `\n${parts.join(" | ")}`);

        return {
            message:
                "Your reschedule request has been received. The salon will contact you to confirm a new time.",
            requestedAt: now,
        };
    });
};
