import type { PoolConnection } from "mysql2/promise";
import EventModel from "../model/events.js";
import AppointmentModel from "../model/appointments.js";
import StaffModel from "../model/staff.js";
import CustomerModel from "../model/customers.js";
import ServiceModel from "../model/services.js";
import InventoryModel from "../model/inventory.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { formatDate } from "../helper/time.js";
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from "../helper/error.js";
import { canTransitionEvent, eventStatusLabel } from "../constant/events.js";
import { assignmentInterval, findConflicts } from "./eventConflicts.js";
import { evaluateAlert } from "./inventory.js";
import { findStaffForUser } from "./appointments.js";
import { createTransactionForEventInConnection } from "./transactions.js";
import { accrueForEvent } from "./commissions.js";
import { assertDayOpen } from "./dailyClose.js";

// Types
import type {
    EventAssignmentRole,
    EventAssignmentStatus,
    EventStatus,
    EventType,
} from "../constant/events.js";
import type {
    BusyEventAssignmentRow,
    EventAssignmentRow,
    EventRow,
    EventServiceRow,
    EventSupplyRow,
    TravelSegmentRow,
    VenueRow,
} from "../model/events.js";
import type { BusyInterval } from "./eventConflicts.js";

export interface VenueDetail {
    id: number;
    name: string;
    address: string;
    contactName: string | null;
    contactPhone: string | null;
    notes: string | null;
    isActive: boolean;
}

export interface EventAssignmentDetail {
    id: number;
    staffId: number;
    staffName: string;
    role: EventAssignmentRole;
    callTime: Date;
    releaseTime: Date;
    travelRequired: boolean;
    status: EventAssignmentStatus;
    commissionSharePercent: number | null;
    notes: string | null;
    conflict: string | null;
}

export interface EventDetail {
    id: number;
    reference: string;
    customer: {
        id: number;
        name: string;
        phone: string | null;
        email: string | null;
    };
    venue: { id: number; name: string } | null;
    title: string;
    eventType: EventType;
    eventDate: string;
    startAt: Date;
    endAt: Date;
    status: EventStatus;
    travelBufferMinutes: number;
    notes: string | null;
    total: number;
    services: Array<{
        serviceId: number;
        name: string;
        quantity: number;
        price: number;
    }>;
    assignments: EventAssignmentDetail[];
    itinerary: Array<{
        id: number;
        staffId: number | null;
        staffName: string | null;
        sequence: number;
        from: string;
        to: string;
        departAt: Date;
        arriveAt: Date;
        mode: string;
        notes: string | null;
    }>;
    supplies: Array<{
        supplyId: number;
        name: string;
        unit: string;
        plannedQuantity: number;
        issuedQuantity: number;
        returnedQuantity: number;
        consumedQuantity: number;
        status: string;
    }>;
}

const toVenue = (row: VenueRow): VenueDetail => ({
    id: row.id,
    name: row.name,
    address: row.address,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    notes: row.notes,
    isActive: row.is_active === 1,
});

const dateOnly = (value: string | Date): string =>
    typeof value === "string" ? value.slice(0, 10) : formatDate(value);

const toEventBase = (row: EventRow): Omit<EventDetail, "services" | "assignments" | "itinerary" | "supplies"> => ({
    id: row.id,
    reference: row.reference,
    customer: {
        id: row.customer_id,
        name: row.customer_name,
        phone: row.customer_phone,
        email: row.customer_email,
    },
    venue: row.venue_id ? { id: row.venue_id, name: row.venue_name ?? "" } : null,
    title: row.title,
    eventType: row.event_type,
    eventDate: dateOnly(row.event_date),
    startAt: row.start_at,
    endAt: row.end_at,
    status: row.status,
    travelBufferMinutes: Number(row.travel_buffer_minutes),
    notes: row.notes,
    total: Number(row.total),
});

const toAssignment = (row: EventAssignmentRow): EventAssignmentDetail => ({
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    role: row.role,
    callTime: row.call_time,
    releaseTime: row.release_time,
    travelRequired: row.travel_required === 1,
    status: row.status,
    commissionSharePercent:
        row.commission_share_percent === null
            ? null
            : Number(row.commission_share_percent),
    notes: row.notes,
    conflict: null,
});

// --- Venues ---

export const listVenues = (includeInactive: boolean): Promise<VenueDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new EventModel(connection).listVenues(includeInactive);
        return rows.map(toVenue);
    });

export interface VenueInput {
    name: string;
    address: string;
    contactName: string | null;
    contactPhone: string | null;
    notes: string | null;
}

export const createVenue = (input: VenueInput): Promise<VenueDetail> =>
    withTransaction(async (connection) => {
        const model = new EventModel(connection);
        if (await model.findVenueByName(input.name)) {
            throw new ConflictError("A venue with this name already exists");
        }
        const id = await model.createVenue(input);
        return toVenue((await model.findVenueById(id))!);
    });

export const updateVenue = (id: number, input: VenueInput): Promise<VenueDetail> =>
    withTransaction(async (connection) => {
        const model = new EventModel(connection);
        if (!(await model.findVenueById(id))) {
            throw new NotFoundError("Venue not found", 404);
        }
        const clash = await model.findVenueByName(input.name);
        if (clash && clash.id !== id) {
            throw new ConflictError("A venue with this name already exists");
        }
        await model.updateVenue(id, input);
        return toVenue((await model.findVenueById(id))!);
    });

// --- Events ---

export interface EventFilterInput {
    from?: Date | null;
    to?: Date | null;
    status?: EventStatus | null;
    search?: string | null;
}

export const listEvents = async (filter: EventFilterInput): Promise<EventDetail[]> => {
    const rows = await withConnection((connection) =>
        new EventModel(connection).listEvents(filter)
    );
    return rows.map((row) => ({
        ...toEventBase(row),
        services: [],
        assignments: [],
        itinerary: [],
        supplies: [],
    }));
};

export const getEvent = (id: number): Promise<EventDetail> =>
    withConnection(async (connection) => {
        const model = new EventModel(connection);
        const row = await model.findEventById(id);
        if (!row) throw new NotFoundError("Event not found", 404);

        const [services, assignments, itinerary, supplies] = await Promise.all([
            model.listEventServices(id),
            model.listAssignments(id),
            model.listTravelSegments(id),
            model.listEventSupplies(id),
        ]);

        return {
            ...toEventBase(row),
            services: services.map((service) => ({
                serviceId: service.service_id,
                name: service.service_name,
                quantity: service.quantity,
                price: Number(service.price),
            })),
            assignments: assignments.map(toAssignment),
            itinerary: itinerary.map((segment) => ({
                id: segment.id,
                staffId: segment.staff_id,
                staffName: segment.staff_name,
                sequence: segment.sequence,
                from: segment.from_label,
                to: segment.to_label,
                departAt: segment.depart_at,
                arriveAt: segment.arrive_at,
                mode: segment.mode,
                notes: segment.notes,
            })),
            supplies: supplies.map((supply) => ({
                supplyId: supply.supply_id,
                name: supply.supply_name,
                unit: supply.unit,
                plannedQuantity: Number(supply.planned_quantity),
                issuedQuantity: Number(supply.issued_quantity),
                returnedQuantity: Number(supply.returned_quantity),
                consumedQuantity: Number(supply.consumed_quantity),
                status: supply.status,
            })),
        };
    });

export interface EventServiceInput {
    serviceId: number;
    quantity: number;
}

export interface EventCustomerInput {
    firstName: string;
    lastName: string | null;
    phone: string | null;
    email: string | null;
}

export interface EventAssignmentInput {
    staffId: number;
    role: EventAssignmentRole;
    callTime: Date;
    releaseTime: Date;
    travelRequired: boolean;
    status?: EventAssignmentStatus | undefined;
    commissionSharePercent?: number | null | undefined;
    notes?: string | null | undefined;
}

export interface CreateEventInput {
    customer: EventCustomerInput;
    venueId: number | null;
    title: string;
    eventType: EventType;
    startAt: Date;
    endAt: Date;
    travelBufferMinutes: number;
    notes: string | null;
    services: EventServiceInput[];
    assignments: EventAssignmentInput[];
    createdBy: number | null;
}

const assertAssignments = async (
    connection: PoolConnection,
    event: EventRow,
    assignments: EventAssignmentInput[]
): Promise<void> => {
    if (assignments.length === 0) return;
    const leads = assignments.filter((item) => item.role === "lead");
    if (leads.length !== 1) {
        throw new BadRequestError("An event must have exactly one lead stylist.");
    }

    const seen = new Set<number>();
    for (const item of assignments) {
        if (seen.has(item.staffId)) {
            throw new BadRequestError("A staff member can only be assigned once per event.");
        }
        seen.add(item.staffId);

        if (item.releaseTime <= item.callTime) {
            throw new BadRequestError("releaseTime must be after callTime.");
        }
        if (
            item.commissionSharePercent !== undefined &&
            item.commissionSharePercent !== null &&
            (item.commissionSharePercent < 0 || item.commissionSharePercent > 100)
        ) {
            throw new BadRequestError("commissionSharePercent must be between 0 and 100.");
        }
    }

    // Lock staff rows in ascending id order to serialize concurrent assignments.
    const appointmentModel = new AppointmentModel(connection);
    const sorted = [...assignments].sort((a, b) => a.staffId - b.staffId);
    for (const item of sorted) {
        await appointmentModel.lockStaffRow(item.staffId);
    }

    const eventModel = new EventModel(connection);
    for (const item of assignments) {
        const staff = await new StaffModel(connection).findById(item.staffId);
        if (!staff || staff.is_active !== 1) {
            throw new NotFoundError("Staff member not available", 404);
        }

        const interval = assignmentInterval({
            callTime: item.callTime,
            releaseTime: item.releaseTime,
            travelRequired: item.travelRequired,
            travelBufferMinutes: event.travel_buffer_minutes,
        });

        const appointmentRows = await appointmentModel.listBusy(
            item.staffId,
            interval.start,
            interval.end
        );
        const appointmentIntervals: BusyInterval[] = appointmentRows.map((row) => ({
            start: new Date(row.start_at),
            end: new Date(row.buffer_end_at),
            kind: "appointment",
            label: "salon appointment",
        }));

        const eventRows = await eventModel.listBusyEventAssignments(
            item.staffId,
            interval.start,
            interval.end,
            event.id
        );
        const eventIntervals: BusyInterval[] = eventRows
            .map((row) => {
                const other = assignmentInterval({
                    callTime: new Date(row.call_time),
                    releaseTime: new Date(row.release_time),
                    travelRequired: row.travel_required === 1,
                    travelBufferMinutes: Number(row.travel_buffer_minutes),
                });
                return {
                    start: other.start,
                    end: other.end,
                    kind: "event" as const,
                    label: `${row.event_title} (${row.event_reference})`,
                };
            });

        const conflicts = findConflicts(interval, [
            ...appointmentIntervals,
            ...eventIntervals,
        ]);
        if (conflicts.length > 0) {
            const first = conflicts[0]!;
            throw new ConflictError(
                `${staff.first_name} ${staff.last_name} already has a commitment: ${first.label}.`
            );
        }
    }
};

const replaceServices = async (
    connection: PoolConnection,
    eventId: number,
    items: EventServiceInput[]
): Promise<void> => {
    const serviceModel = new ServiceModel(connection);
    const seen = new Set<number>();
    const lines: Array<{
        serviceId: number;
        quantity: number;
        price: number;
        durationMinutes: number | null;
    }> = [];

    for (const item of items) {
        if (seen.has(item.serviceId)) {
            throw new BadRequestError("A service can only appear once per event.");
        }
        seen.add(item.serviceId);
        if (item.quantity <= 0) {
            throw new BadRequestError("Service quantity must be greater than zero.");
        }
        const service = await serviceModel.findById(item.serviceId);
        if (!service || service.is_active !== 1) {
            throw new NotFoundError("Service not available", 404);
        }
        lines.push({
            serviceId: service.id,
            quantity: item.quantity,
            price: service.price,
            durationMinutes: service.duration_minutes,
        });
    }

    await new EventModel(connection).replaceEventServices(eventId, lines);
};

const replaceAssignments = async (
    connection: PoolConnection,
    event: EventRow,
    items: EventAssignmentInput[]
): Promise<void> => {
    await assertAssignments(connection, event, items);
    await new EventModel(connection).replaceAssignments(
        event.id,
        items.map((item) => ({
            staffId: item.staffId,
            role: item.role,
            callTime: item.callTime,
            releaseTime: item.releaseTime,
            travelRequired: item.travelRequired,
            status: item.status ?? "assigned",
            commissionSharePercent: item.commissionSharePercent ?? null,
            notes: item.notes ?? null,
        }))
    );
};

export const createEvent = async (input: CreateEventInput): Promise<EventDetail> => {
    const id = await withTransaction(async (connection) => {
        if (input.endAt <= input.startAt) {
            throw new BadRequestError("endAt must be after startAt.");
        }
        if (!input.customer.phone && !input.customer.email) {
            throw new BadRequestError(
                "Please provide a phone number or an email address for the customer."
            );
        }

        const customerModel = new CustomerModel(connection);
        let customer = await customerModel.findMatch(
            input.customer.phone,
            input.customer.email
        );
        if (!customer) {
            const customerId = await customerModel.create(input.customer);
            customer = {
                id: customerId,
                first_name: input.customer.firstName,
                last_name: input.customer.lastName,
                phone: input.customer.phone,
                email: input.customer.email,
            };
        }

        const venueId = input.venueId;
        if (venueId !== null) {
            const venue = await new EventModel(connection).findVenueById(venueId);
            if (!venue) throw new NotFoundError("Venue not found", 404);
        }

        const model = new EventModel(connection);
        const id = await model.insertEvent({
            customerId: customer.id,
            venueId,
            title: input.title,
            eventType: input.eventType,
            eventDate: formatDate(input.startAt),
            startAt: input.startAt,
            endAt: input.endAt,
            travelBufferMinutes: input.travelBufferMinutes,
            notes: input.notes,
            createdBy: input.createdBy,
        });

        const reference = `EVT-${formatDate(input.startAt).replace(/-/g, "")}-${String(
            id
        ).padStart(4, "0")}`;
        await model.updateReference(id, reference);

        await replaceServices(connection, id, input.services);
        const row = (await model.findEventById(id))!;
        await replaceAssignments(connection, row, input.assignments);

        return id;
    });

    return getEvent(id);
};

export interface UpdateEventInput {
    venueId: number | null;
    title: string;
    eventType: EventType;
    startAt: Date;
    endAt: Date;
    travelBufferMinutes: number;
    notes: string | null;
    services?: EventServiceInput[] | undefined;
    assignments?: EventAssignmentInput[] | undefined;
}

export const updateEvent = async (
    id: number,
    input: UpdateEventInput
): Promise<EventDetail> => {
    await withTransaction(async (connection) => {
        if (input.endAt <= input.startAt) {
            throw new BadRequestError("endAt must be after startAt.");
        }
        const model = new EventModel(connection);
        const existing = await model.findEventById(id);
        if (!existing) throw new NotFoundError("Event not found", 404);

        if (input.venueId !== null) {
            const venue = await model.findVenueById(input.venueId);
            if (!venue) throw new NotFoundError("Venue not found", 404);
        }

        await model.updateEvent(id, {
            venueId: input.venueId,
            title: input.title,
            eventType: input.eventType,
            eventDate: formatDate(input.startAt),
            startAt: input.startAt,
            endAt: input.endAt,
            travelBufferMinutes: input.travelBufferMinutes,
            notes: input.notes,
        });

        if (input.services !== undefined) {
            await replaceServices(connection, id, input.services);
        }
        if (input.assignments !== undefined) {
            const row = (await model.findEventById(id))!;
            await replaceAssignments(connection, row, input.assignments);
        }
    });

    return getEvent(id);
};

export const changeEventStatus = async (
    id: number,
    status: EventStatus
): Promise<EventDetail> => {
    await withTransaction(async (connection) => {
        const model = new EventModel(connection);
        const event = await model.findEventById(id);
        if (!event) throw new NotFoundError("Event not found", 404);
        if (event.status === status) {
            throw new BadRequestError(
                `This event is already marked as ${eventStatusLabel(status)}.`
            );
        }
        if (!canTransitionEvent(event.status, status)) {
            throw new ConflictError(
                `A ${eventStatusLabel(event.status)} event cannot be changed to ${eventStatusLabel(
                    status
                )}.`
            );
        }

        // Completing an event writes revenue into today's ledger, so a closed
        // business day must be reopened first.
        if (status === "completed") {
            await assertDayOpen(connection, new Date());
        }

        await model.updateStatus(id, status);

        if (status === "completed") {
            const assignments = await model.listAssignments(id);
            const services = await model.listEventServices(id);
            const lead =
                assignments.find((assignment) => assignment.role === "lead") ??
                assignments[0];

            if (!lead || services.length === 0) {
                throw new ConflictError(
                    "Assign a lead stylist and at least one service before completing the event."
                );
            }

            const transaction = await createTransactionForEventInConnection(connection, {
                eventId: id,
                customerId: event.customer_id,
                staffId: lead.staff_id,
                serviceId: services[0]!.service_id,
                price: Number(event.total),
                completedAt: new Date(),
            });

            await accrueForEvent(connection, {
                event,
                transaction,
                completedAt: transaction.completedAt,
            });
        }
    });

    return getEvent(id);
};

// --- Itinerary ---

export interface TravelSegmentInput {
    staffId: number | null;
    sequence: number;
    from: string;
    to: string;
    departAt: Date;
    arriveAt: Date;
    mode: string;
    notes: string | null;
}

export const replaceItinerary = async (
    eventId: number,
    items: TravelSegmentInput[]
): Promise<EventDetail> => {
    await withTransaction(async (connection) => {
        const model = new EventModel(connection);
        const event = await model.findEventById(eventId);
        if (!event) throw new NotFoundError("Event not found", 404);

        const assignments = await model.listAssignments(eventId);
        const sorted = [...items].sort((a, b) => a.sequence - b.sequence);

        let previousArrive: Date | null = null;
        for (const item of sorted) {
            if (item.arriveAt < item.departAt) {
                throw new BadRequestError("arriveAt must be on or after departAt.");
            }
            if (previousArrive && item.departAt < previousArrive) {
                throw new BadRequestError(
                    "Travel segments must not overlap; check the sequence and times."
                );
            }
            previousArrive = item.arriveAt;

            if (item.staffId !== null) {
                const assignment = assignments.find((a) => a.staff_id === item.staffId);
                if (!assignment) {
                    throw new BadRequestError(
                        "A travel segment's staff member must be assigned to this event."
                    );
                }
                if (item.arriveAt > assignment.call_time) {
                    throw new ConflictError(
                        "Travel must arrive before the staff member's call time."
                    );
                }
            }
        }

        // Team-wide first segment must arrive before the earliest call time.
        const teamSegment = sorted.find((item) => item.staffId === null);
        if (teamSegment && assignments.length > 0) {
            const earliest = assignments.reduce(
                (min, item) => (item.call_time < min ? item.call_time : min),
                assignments[0]!.call_time
            );
            if (teamSegment.arriveAt > earliest) {
                throw new ConflictError("Travel must arrive before the earliest call time.");
            }
        }

        await model.replaceTravelSegments(
            eventId,
            sorted.map((item) => ({
                staffId: item.staffId,
                sequence: item.sequence,
                fromLabel: item.from,
                toLabel: item.to,
                departAt: item.departAt,
                arriveAt: item.arriveAt,
                mode: item.mode,
                notes: item.notes,
            }))
        );
    });

    return getEvent(eventId);
};

// --- Event kit ---

export interface EventSupplyInput {
    supplyId: number;
    plannedQuantity: number;
}

export const replaceEventSupplies = async (
    eventId: number,
    items: EventSupplyInput[]
): Promise<EventDetail> => {
    await withTransaction(async (connection) => {
        const model = new EventModel(connection);
        if (!(await model.findEventById(eventId))) {
            throw new NotFoundError("Event not found", 404);
        }

        const inventory = new InventoryModel(connection);
        const seen = new Set<number>();
        for (const item of items) {
            if (seen.has(item.supplyId)) {
                throw new BadRequestError("A supply can only appear once in an event kit.");
            }
            seen.add(item.supplyId);
            if (item.plannedQuantity < 0) {
                throw new BadRequestError("plannedQuantity must be 0 or more.");
            }
            if (!(await inventory.findSupplyById(item.supplyId))) {
                throw new NotFoundError("Supply not found", 404);
            }
        }

        await model.replaceEventSupplies(eventId, items);
    });

    return getEvent(eventId);
};

export const issueEventSupplies = async (
    eventId: number,
    actorUserId: number | null
): Promise<EventDetail> => {
    await withTransaction(async (connection) => {
        const model = new EventModel(connection);
        if (!(await model.findEventById(eventId))) {
            throw new NotFoundError("Event not found", 404);
        }

        const inventory = new InventoryModel(connection);
        const supplies = (await model.listEventSupplies(eventId)).sort(
            (a, b) => a.supply_id - b.supply_id
        );

        for (const item of supplies) {
            const planned = Number(item.planned_quantity);
            const issued = Number(item.issued_quantity);
            const delta = planned - issued;
            if (delta <= 0) continue;

            const supply = await inventory.lockSupplyRow(item.supply_id);
            if (!supply) throw new NotFoundError("Supply not found", 404);

            const before = Number(supply.current_quantity);
            if (before < delta) {
                throw new ConflictError(
                    `Not enough ${supply.name}. Needed ${delta} ${supply.unit}, available ${before}.`
                );
            }

            const after = before - delta;
            await inventory.updateQuantity(supply.id, after);
            await inventory.insertMovement({
                supplyId: supply.id,
                movementType: "event_issue",
                quantityDelta: -delta,
                balanceAfter: after,
                unitCost: supply.unit_cost,
                referenceType: "event",
                referenceId: eventId,
                notes: `Issued to event #${eventId}`,
                createdBy: actorUserId,
            });
            await model.updateEventSupply(item.id, {
                issuedQuantity: planned,
                returnedQuantity: Number(item.returned_quantity),
                consumedQuantity: Number(item.consumed_quantity),
                status: "issued",
            });
            await evaluateAlert(connection, supply.id, actorUserId);
        }
    });

    return getEvent(eventId);
};

export interface SettleEventSupplyInput {
    supplyId: number;
    consumedQuantity: number;
    returnedQuantity: number;
}

export const settleEventSupplies = async (
    eventId: number,
    items: SettleEventSupplyInput[],
    actorUserId: number | null
): Promise<EventDetail> => {
    await withTransaction(async (connection) => {
        const model = new EventModel(connection);
        if (!(await model.findEventById(eventId))) {
            throw new NotFoundError("Event not found", 404);
        }

        const inventory = new InventoryModel(connection);

        for (const item of items) {
            const row = await model.findEventSupply(eventId, item.supplyId);
            if (!row) throw new NotFoundError("Event supply not found", 404);

            const issued = Number(row.issued_quantity);
            if (item.consumedQuantity < 0 || item.returnedQuantity < 0) {
                throw new BadRequestError("Kit quantities must be 0 or more.");
            }
            if (item.consumedQuantity + item.returnedQuantity > issued) {
                throw new ConflictError(
                    `Consumed + returned cannot exceed issued for ${row.supply_name}.`
                );
            }

            if (item.returnedQuantity > 0) {
                const supply = await inventory.lockSupplyRow(item.supplyId);
                if (!supply) throw new NotFoundError("Supply not found", 404);
                const after = Number(supply.current_quantity) + item.returnedQuantity;
                await inventory.updateQuantity(item.supplyId, after);
                await inventory.insertMovement({
                    supplyId: item.supplyId,
                    movementType: "event_return",
                    quantityDelta: item.returnedQuantity,
                    balanceAfter: after,
                    unitCost: supply.unit_cost,
                    referenceType: "event",
                    referenceId: eventId,
                    notes: `Returned from event #${eventId}`,
                    createdBy: actorUserId,
                });
            }

            const accounted = item.consumedQuantity + item.returnedQuantity;
            await model.updateEventSupply(row.id, {
                issuedQuantity: issued,
                returnedQuantity: item.returnedQuantity,
                consumedQuantity: item.consumedQuantity,
                status: accounted >= issued ? "returned" : "short",
            });
        }
    });

    return getEvent(eventId);
};

// --- Staff portal ---

export interface StaffEventDetail {
    eventId: number;
    reference: string;
    title: string;
    eventDate: string;
    startAt: Date;
    endAt: Date;
    venueName: string | null;
    role: EventAssignmentRole;
    callTime: Date;
    releaseTime: Date;
    travelRequired: boolean;
    status: EventAssignmentStatus;
}

export const listEventsForStaffUser = async (
    userId: number,
    from: Date,
    to: Date
): Promise<StaffEventDetail[]> => {
    const staff = await findStaffForUser(userId);
    if (!staff) return [];

    const rows = await withConnection((connection) =>
        new EventModel(connection).listAssignmentsForStaff(staff.id, from, to)
    );

    return rows.map((row) => ({
        eventId: row.event_id,
        reference: row.event_reference,
        title: row.event_title,
        eventDate: dateOnly(row.event_date),
        startAt: row.start_at,
        endAt: row.end_at,
        venueName: row.venue_name,
        role: row.role,
        callTime: row.call_time,
        releaseTime: row.release_time,
        travelRequired: row.travel_required === 1,
        status: row.status,
    }));
};

export type { BusyEventAssignmentRow, EventSupplyRow, TravelSegmentRow };
