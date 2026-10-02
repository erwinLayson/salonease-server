import AppointmentModel from "../model/appointments.js";
import CustomerModel from "../model/customers.js";
import StaffModel from "../model/staff.js";
import ServiceModel from "../model/services.js";
import { withTransaction } from "../helper/withConnection.js";
import { addMinutes } from "../helper/time.js";
import { generateAppointmentReference, generateManageToken } from "../helper/reference.js";
import { BOOKING_RULES } from "../config/booking.js";
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    isDuplicateKeyError,
} from "../helper/error.js";

// Types
import type { AppointmentRow } from "../model/appointments.js";

export interface BookingCustomer {
    firstName: string;
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
}

export interface CreateBookingInput {
    customer: BookingCustomer;
    staffId: number;
    serviceId: number;
    startAt: Date;
    source?: "online" | "manual";
    createdBy?: number | null;
}

/**
 * Creates an appointment, rejecting any conflict.
 *
 * Everything runs inside one transaction:
 *   1. Validate service + staff are active and the staff member is eligible.
 *   2. Lock the staff row (`SELECT ... FOR UPDATE`) so simultaneous requests for
 *      the same staff member are serialized.
 *   3. Re-check for an overlapping active appointment.
 *   4. Match-or-create the customer and insert the appointment.
 *
 * Two layers stop double booking: the row lock + overlap re-check above, and the
 * `uq_appointments_active_slot` unique key in the database.
 */
export const createBooking = (input: CreateBookingInput): Promise<AppointmentRow> =>
    withTransaction(async (connection) => {
        const staffModel = new StaffModel(connection);
        const staff = await staffModel.findById(input.staffId);

        if (!staff || staff.is_active !== 1) {
            throw new NotFoundError("Staff member not available", 404);
        }

        const service = await new ServiceModel(connection).findById(input.serviceId);
        if (!service || service.is_active !== 1) {
            throw new NotFoundError("Service not available", 404);
        }

        if (!(await staffModel.isEligible(input.staffId, input.serviceId))) {
            throw new BadRequestError("This staff member does not offer the selected service");
        }

        const appointmentModel = new AppointmentModel(connection);

        // Serialize bookings for this staff member.
        await appointmentModel.lockStaffRow(input.staffId);

        const endAt = addMinutes(input.startAt, service.duration_minutes);
        const bufferEndAt = addMinutes(endAt, BOOKING_RULES.bufferMinutes);

        const clash = await appointmentModel.findOverlap(input.staffId, input.startAt, bufferEndAt);
        if (clash) {
            throw new ConflictError(
                "That time slot has just been taken. Please choose another slot."
            );
        }

        const customerModel = new CustomerModel(connection);
        const phone = input.customer.phone ?? null;
        const email = input.customer.email ?? null;

        const existing = await customerModel.findMatch(phone, email);
        const customerId =
            existing?.id ??
            (await customerModel.create({
                firstName: input.customer.firstName,
                lastName: input.customer.lastName ?? null,
                phone,
                email,
            }));

        let id: number;
        try {
            id = await appointmentModel.insert({
                reference: generateAppointmentReference(),
                manageToken: generateManageToken(),
                customerId,
                staffId: input.staffId,
                serviceId: input.serviceId,
                startAt: input.startAt,
                endAt,
                bufferEndAt,
                price: service.price,
                status: "pending",
                source: input.source ?? "online",
                createdBy: input.createdBy ?? null,
            });
        } catch (err) {
            // Backstop: the unique key uq_appointments_active_slot also rejects a
            // duplicate active booking, so surface it as a normal conflict.
            if (isDuplicateKeyError(err)) {
                throw new ConflictError(
                    "That time slot has just been taken. Please choose another slot."
                );
            }
            throw err;
        }

        return (await appointmentModel.findById(id))!;
    });
