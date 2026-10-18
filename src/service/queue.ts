import QueueModel from "../model/queue.js";
import ServiceModel from "../model/services.js";
import StaffModel from "../model/staff.js";
import { createManualBooking } from "./appointments.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { formatDate, minutesBetween, toDateString } from "../helper/time.js";
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    isDuplicateKeyError,
} from "../helper/error.js";
import { canTransitionQueue, queueStatusLabel } from "../constant/queue.js";

// Types
import type { QueueStatus } from "../constant/queue.js";
import type { WalkInTicketRow } from "../model/queue.js";

export interface QueueTicketDetail {
    id: number;
    queueDate: string;
    ticketNumber: number;
    customerName: string;
    customerPhone: string | null;
    service: { id: number; name: string; durationMinutes: number };
    preferredStaff: { id: number; name: string } | null;
    assignedStaff: { id: number; name: string } | null;
    status: QueueStatus;
    checkedInAt: Date;
    calledAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    estimatedWaitMinutes: number | null;
    appointmentId: number | null;
    notes: string | null;
}

const toDetail = (row: WalkInTicketRow): QueueTicketDetail => ({
    id: row.id,
    queueDate: row.queue_date,
    ticketNumber: row.ticket_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    service: {
        id: row.service_id,
        name: row.service_name,
        durationMinutes: row.service_duration_minutes,
    },
    preferredStaff: row.preferred_staff_id
        ? { id: row.preferred_staff_id, name: row.preferred_staff_name ?? "" }
        : null,
    assignedStaff: row.assigned_staff_id
        ? { id: row.assigned_staff_id, name: row.assigned_staff_name ?? "" }
        : null,
    status: row.status,
    checkedInAt: row.checked_in_at,
    calledAt: row.called_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    estimatedWaitMinutes: row.estimated_wait_minutes,
    appointmentId: row.appointment_id,
    notes: row.notes,
});

/**
 * Pure ETA calculation over the current queue snapshot.
 *
 * `aheadMinutes` is the remaining service time of everyone ahead of this
 * ticket; divide by the number of available staff and round up to the next
 * 5-minute mark. Exported so the maths can be unit-tested without a database.
 */
export const estimateWaitMinutes = (
    aheadMinutes: number,
    staffCount: number
): number => {
    if (aheadMinutes <= 0) return 0;
    const perStaff = aheadMinutes / Math.max(1, staffCount);
    return Math.ceil(perStaff / 5) * 5;
};

/** Recomputes and stores the ETA for every waiting/called ticket on a date. */
const refreshEstimates = async (model: QueueModel, queueDate: string): Promise<void> => {
    const rows = await model.listForEstimate(queueDate);
    const now = new Date();
    const activeStaff = await model.countActiveStaff();

    for (const ticket of rows) {
        if (ticket.status === "in_service") {
            continue;
        }

        const ahead = rows
            .filter((row) => row.ticket_number < ticket.ticket_number)
            .reduce((sum, row) => {
                if (row.status !== "in_service" || !row.started_at) {
                    return sum + row.service_duration_minutes;
                }
                const elapsed = minutesBetween(new Date(row.started_at), now);
                return sum + Math.max(0, row.service_duration_minutes - elapsed);
            }, 0);

        await model.updateEstimate(ticket.id, estimateWaitMinutes(ahead, activeStaff));
    }
};

export const listQueue = (date: string): Promise<QueueTicketDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new QueueModel(connection).listByDate(date);
        return rows.map(toDetail);
    });

export const getTicket = (id: number): Promise<QueueTicketDetail> =>
    withConnection(async (connection) => {
        const row = await new QueueModel(connection).findById(id);
        if (!row) throw new NotFoundError("Queue ticket not found", 404);
        return toDetail(row);
    });

export interface CreateTicketInput {
    date?: string | undefined;
    customerName: string;
    customerPhone: string | null;
    serviceId: number;
    preferredStaffId?: number | null;
    assignedStaffId?: number | null;
    notes?: string | null;
    createdBy: number | null;
}

/**
 * Creates a ticket. The ticket number is `MAX + 1` per date; a duplicate-key
 * clash from two simultaneous check-ins is retried on a fresh transaction.
 */
export const createTicket = async (
    input: CreateTicketInput
): Promise<QueueTicketDetail> => {
    const queueDate = input.date ?? formatDate(new Date());

    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await withTransaction(async (connection) => {
                const service = await new ServiceModel(connection).findById(input.serviceId);
                if (!service || service.is_active !== 1) {
                    throw new NotFoundError("Service not available", 404);
                }

                if (input.preferredStaffId) {
                    const staff = await new StaffModel(connection).findById(input.preferredStaffId);
                    if (!staff || staff.is_active !== 1) {
                        throw new NotFoundError("Preferred staff member not available", 404);
                    }
                }
                if (input.assignedStaffId) {
                    const staff = await new StaffModel(connection).findById(input.assignedStaffId);
                    if (!staff || staff.is_active !== 1) {
                        throw new NotFoundError("Assigned staff member not available", 404);
                    }
                }

                const model = new QueueModel(connection);
                const ticketNumber = (await model.maxTicketNumber(queueDate)) + 1;

                const id = await model.insert({
                    queueDate,
                    ticketNumber,
                    customerName: input.customerName,
                    customerPhone: input.customerPhone,
                    serviceId: input.serviceId,
                    preferredStaffId: input.preferredStaffId ?? null,
                    assignedStaffId: input.assignedStaffId ?? null,
                    checkedInAt: new Date(),
                    estimatedWaitMinutes: null,
                    notes: input.notes ?? null,
                    createdBy: input.createdBy,
                });

                await refreshEstimates(model, queueDate);
                return toDetail((await model.findById(id))!);
            });
        } catch (err) {
            if (isDuplicateKeyError(err) && attempt < 2) continue;
            throw err;
        }
    }

    throw new ConflictError("Could not issue a queue ticket. Please try again.");
};

export interface ChangeQueueStatusInput {
    status: QueueStatus;
    assignedStaffId?: number | null | undefined;
}

export const changeQueueStatus = (
    id: number,
    input: ChangeQueueStatusInput
): Promise<QueueTicketDetail> =>
    withTransaction(async (connection) => {
        const model = new QueueModel(connection);
        const row = await model.findById(id);
        if (!row) throw new NotFoundError("Queue ticket not found", 404);

        if (row.status === input.status) {
            throw new BadRequestError(
                `This ticket is already marked as ${queueStatusLabel(input.status)}.`
            );
        }
        if (!canTransitionQueue(row.status, input.status)) {
            throw new ConflictError(
                `A ${queueStatusLabel(row.status)} ticket cannot be changed to ${queueStatusLabel(
                    input.status
                )}.`
            );
        }

        if (input.assignedStaffId !== undefined) {
            if (input.assignedStaffId !== null) {
                const staff = await new StaffModel(connection).findById(input.assignedStaffId);
                if (!staff || staff.is_active !== 1) {
                    throw new NotFoundError("Assigned staff member not available", 404);
                }
            }
            await model.updateAssignment(id, input.assignedStaffId);
        }

        await model.updateStatus(id, input.status);
        await refreshEstimates(model, row.queue_date);
        return toDetail((await model.findById(id))!);
    });

export interface ConvertTicketInput {
    staffId: number;
    startAt: Date;
    createdBy: number | null;
}

/**
 * Converts a queue ticket into a normal appointment. The ticket keeps its
 * audit trail and is marked completed; the appointment becomes the source of
 * truth for the service itself.
 */
export const convertTicket = async (
    id: number,
    input: ConvertTicketInput
): Promise<QueueTicketDetail> => {
    const ticket = await getTicket(id);

    if (!ticket.customerPhone) {
        throw new BadRequestError(
            "A phone number is required before converting this ticket to an appointment."
        );
    }
    if (ticket.status === "completed" || ticket.status === "cancelled") {
        throw new ConflictError("This ticket is already closed.");
    }
    if (ticket.appointmentId) {
        throw new ConflictError("This ticket has already been converted.");
    }

    const appointment = await createManualBooking({
        customer: {
            firstName: ticket.customerName,
            lastName: null,
            phone: ticket.customerPhone,
            email: null,
        },
        staffId: input.staffId,
        serviceId: ticket.service.id,
        startAt: input.startAt,
        notes: `Converted from walk-in ticket #${ticket.ticketNumber}`,
        createdBy: input.createdBy,
    });

    await withTransaction(async (connection) => {
        const model = new QueueModel(connection);
        await model.attachAppointment(id, appointment.id);
        await model.updateStatus(id, "completed");
        await refreshEstimates(model, ticket.queueDate);
    });

    return getTicket(id);
};

export interface WaitTimeMetrics {
    tickets: number;
    served: number;
    avgWaitMinutes: number;
    longestWaitMinutes: number;
}

export interface WaitTimeDay extends WaitTimeMetrics {
    date: string;
}

export interface WaitTimeStaff extends WaitTimeMetrics {
    staffId: number | null;
    staffName: string;
}

export interface WaitTimeReport {
    from: string;
    to: string;
    overall: WaitTimeMetrics;
    days: WaitTimeDay[];
    staff: WaitTimeStaff[];
}

const toMetrics = (row: {
    tickets: number;
    served: number;
    avg_wait_minutes: number;
    longest_wait_minutes: number;
}): WaitTimeMetrics => ({
    tickets: Number(row.tickets),
    served: Number(row.served),
    avgWaitMinutes: Math.round(Number(row.avg_wait_minutes)),
    longestWaitMinutes: Number(row.longest_wait_minutes),
});

/** Owner wait-time report: overall, per day and per staff member. */
export const getWaitTimeReport = (
    from: string,
    to: string
): Promise<WaitTimeReport> =>
    withConnection(async (connection) => {
        const model = new QueueModel(connection);
        const [dayRows, staffRows] = await Promise.all([
            model.waitTimeByDay(from, to),
            model.waitTimeByStaff(from, to),
        ]);

        const days = dayRows.map((row) => ({
            date: toDateString(row.bucket),
            ...toMetrics(row),
        }));
        const staff = staffRows.map((row) => ({
            staffId: row.staff_id === null ? null : Number(row.staff_id),
            staffName: row.staff_name ?? "Unassigned",
            ...toMetrics(row),
        }));

        const tickets = days.reduce((sum, row) => sum + row.tickets, 0);
        const served = days.reduce((sum, row) => sum + row.served, 0);
        const weightedWait = days.reduce(
            (sum, row) => sum + row.avgWaitMinutes * row.served,
            0
        );
        const overall: WaitTimeMetrics = {
            tickets,
            served,
            avgWaitMinutes: served > 0 ? Math.round(weightedWait / served) : 0,
            longestWaitMinutes: days.reduce(
                (max, row) => Math.max(max, row.longestWaitMinutes),
                0
            ),
        };

        return { from, to, overall, days, staff };
    });

export interface QueueAssignmentCheck {
    ticket: QueueTicketDetail;
    staff: { id: number; name: string; available: boolean };
}

/**
 * Lightweight availability check used by the owner queue board before calling
 * a specific staff member. It checks the staff member is active/eligible; the
 * full slot check still happens when converting via `createManualBooking`.
 */
export const checkAssignment = async (
    ticketId: number,
    staffId: number
): Promise<QueueAssignmentCheck> => {
    const ticket = await getTicket(ticketId);
    const staff = await withConnection((connection) =>
        new StaffModel(connection).findById(staffId)
    );

    if (!staff) throw new NotFoundError("Staff member not found", 404);
    const eligible = await withConnection((connection) =>
        new StaffModel(connection).isEligible(staffId, ticket.service.id)
    );

    return {
        ticket,
        staff: {
            id: staff.id,
            name: `${staff.first_name} ${staff.last_name}`.trim(),
            available: staff.is_active === 1 && eligible,
        },
    };
};
