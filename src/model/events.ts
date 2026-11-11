import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";
import { safeRowLimit } from "../helper/sql.js";

// Types
import type {
    EventAssignmentRole,
    EventAssignmentStatus,
    EventStatus,
    EventType,
} from "../constant/events.js";
import type { SupplyCategory } from "../constant/inventory.js";

export type VenueRow = {
    id: number;
    name: string;
    address: string;
    contact_name: string | null;
    contact_phone: string | null;
    notes: string | null;
    is_active: number;
};

export type EventRow = {
    id: number;
    reference: string;
    customer_id: number;
    customer_name: string;
    customer_phone: string | null;
    customer_email: string | null;
    venue_id: number | null;
    venue_name: string | null;
    venue_address?: string | null;
    title: string;
    event_type: EventType;
    event_date: string;
    start_at: Date;
    end_at: Date;
    status: EventStatus;
    travel_buffer_minutes: number;
    notes: string | null;
    created_by: number | null;
    total: number;
    created_at: Date;
    updated_at: Date | null;
};

export type EventServiceRow = {
    id: number;
    event_id: number;
    service_id: number;
    service_name: string;
    quantity: number;
    price: number;
    duration_minutes: number | null;
};

export type EventAssignmentRow = {
    id: number;
    event_id: number;
    staff_id: number;
    staff_name: string;
    role: EventAssignmentRole;
    call_time: Date;
    release_time: Date;
    travel_required: number;
    status: EventAssignmentStatus;
    commission_share_percent: number | null;
    notes: string | null;
};

export type TravelSegmentRow = {
    id: number;
    event_id: number;
    staff_id: number | null;
    staff_name: string | null;
    sequence: number;
    from_label: string;
    to_label: string;
    depart_at: Date;
    arrive_at: Date;
    mode: string;
    notes: string | null;
};

export type EventSupplyRow = {
    id: number;
    event_id: number;
    supply_id: number;
    supply_name: string;
    unit: string;
    category: SupplyCategory;
    planned_quantity: number;
    issued_quantity: number;
    returned_quantity: number;
    consumed_quantity: number;
    status: string;
};

export type BusyEventAssignmentRow = {
    event_id: number;
    event_reference: string;
    event_title: string;
    staff_id: number;
    staff_name: string;
    call_time: Date;
    release_time: Date;
    travel_required: number;
    travel_buffer_minutes: number;
    status: EventAssignmentStatus;
};

export type EventFilter = {
    from?: Date | null;
    to?: Date | null;
    status?: EventStatus | null;
    search?: string | null;
    limit?: number;
};

const EVENT_SELECT = `
    SELECT e.id, e.reference, e.customer_id,
           CONCAT_WS(' ', c.first_name, c.last_name) AS customer_name,
           c.phone AS customer_phone, c.email AS customer_email,
           e.venue_id, v.name AS venue_name, v.address AS venue_address, e.title, e.event_type, e.event_date,
           e.start_at, e.end_at, e.status, e.travel_buffer_minutes, e.notes,
           e.created_by, e.created_at, e.updated_at,
           COALESCE((SELECT SUM(es.price * es.quantity) FROM event_services es
                     WHERE es.event_id = e.id), 0) AS total
    FROM events e
    JOIN customers c ON c.id = e.customer_id
    LEFT JOIN venues v ON v.id = e.venue_id
`;

const ASSIGNMENT_SELECT = `
    SELECT ea.id, ea.event_id, ea.staff_id,
           CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
           ea.role, ea.call_time, ea.release_time, ea.travel_required,
           ea.status, ea.commission_share_percent, ea.notes
    FROM event_staff_assignments ea
    JOIN staff s ON s.id = ea.staff_id
`;

export default class EventModel {
    constructor(private connection: PoolConnection) {}

    // --- Venues ---

    async listVenues(includeInactive: boolean): Promise<VenueRow[]> {
        try {
            const where = includeInactive ? "" : "WHERE is_active = 1";
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `SELECT id, name, address, contact_name, contact_phone, notes, is_active
                 FROM venues ${where} ORDER BY name`
            );
            return rows as VenueRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findVenueById(id: number): Promise<VenueRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, name, address, contact_name, contact_phone, notes, is_active
                 FROM venues WHERE id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as VenueRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findVenueByName(name: string): Promise<VenueRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT id, name, address, contact_name, contact_phone, notes, is_active
                 FROM venues WHERE name = ? LIMIT 1`,
                [name]
            );
            return (rows[0] as VenueRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async createVenue(input: {
        name: string;
        address: string;
        contactName: string | null;
        contactPhone: string | null;
        notes: string | null;
    }): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO venues (name, address, contact_name, contact_phone, notes)
                 VALUES (?, ?, ?, ?, ?)`,
                [input.name, input.address, input.contactName, input.contactPhone, input.notes]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateVenue(
        id: number,
        input: {
            name: string;
            address: string;
            contactName: string | null;
            contactPhone: string | null;
            notes: string | null;
        }
    ): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE venues SET name = ?, address = ?, contact_name = ?,
                    contact_phone = ?, notes = ? WHERE id = ?`,
                [input.name, input.address, input.contactName, input.contactPhone, input.notes, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    // --- Events ---

    async listEvents(filter: EventFilter): Promise<EventRow[]> {
        try {
            const clauses: string[] = [];
            const params: Array<string | number | Date | null> = [];

            if (filter.from) {
                clauses.push("e.event_date >= ?");
                params.push(filter.from);
            }
            if (filter.to) {
                clauses.push("e.event_date < ?");
                params.push(filter.to);
            }
            if (filter.status) {
                clauses.push("e.status = ?");
                params.push(filter.status);
            }
            if (filter.search) {
                const like = `%${filter.search}%`;
                clauses.push(
                    "(e.reference LIKE ? OR e.title LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)"
                );
                params.push(like, like, like, like);
            }

            const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
            const limit = safeRowLimit(filter.limit);
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${EVENT_SELECT} ${where} ORDER BY e.start_at LIMIT ${limit}`,
                params
            );
            return rows as EventRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findEventById(id: number): Promise<EventRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${EVENT_SELECT} WHERE e.id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as EventRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async insertEvent(input: {
        customerId: number;
        venueId: number | null;
        title: string;
        eventType: EventType;
        eventDate: string;
        startAt: Date;
        endAt: Date;
        travelBufferMinutes: number;
        notes: string | null;
        createdBy: number | null;
    }): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO events
                    (reference, customer_id, venue_id, title, event_type, event_date,
                     start_at, end_at, status, travel_buffer_minutes, notes, created_by)
                 VALUES ('EVT-PENDING', ?, ?, ?, ?, ?, ?, ?, 'inquiry', ?, ?, ?)`,
                [
                    input.customerId,
                    input.venueId,
                    input.title,
                    input.eventType,
                    input.eventDate,
                    input.startAt,
                    input.endAt,
                    input.travelBufferMinutes,
                    input.notes,
                    input.createdBy,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateReference(id: number, reference: string): Promise<void> {
        try {
            await this.connection.execute("UPDATE events SET reference = ? WHERE id = ?", [
                reference,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateEvent(
        id: number,
        input: {
            venueId: number | null;
            title: string;
            eventType: EventType;
            eventDate: string;
            startAt: Date;
            endAt: Date;
            travelBufferMinutes: number;
            notes: string | null;
        }
    ): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE events
                 SET venue_id = ?, title = ?, event_type = ?, event_date = ?,
                     start_at = ?, end_at = ?, travel_buffer_minutes = ?, notes = ?
                 WHERE id = ?`,
                [
                    input.venueId,
                    input.title,
                    input.eventType,
                    input.eventDate,
                    input.startAt,
                    input.endAt,
                    input.travelBufferMinutes,
                    input.notes,
                    id,
                ]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateStatus(id: number, status: EventStatus): Promise<void> {
        try {
            await this.connection.execute("UPDATE events SET status = ? WHERE id = ?", [
                status,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    // --- Event services ---

    async listEventServices(eventId: number): Promise<EventServiceRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT es.id, es.event_id, es.service_id, sv.name AS service_name,
                        es.quantity, es.price, es.duration_minutes
                 FROM event_services es
                 JOIN services sv ON sv.id = es.service_id
                 WHERE es.event_id = ?
                 ORDER BY sv.name`,
                [eventId]
            );
            return rows as EventServiceRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async replaceEventServices(
        eventId: number,
        items: Array<{ serviceId: number; quantity: number; price: number; durationMinutes: number | null }>
    ): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM event_services WHERE event_id = ?", [
                eventId,
            ]);
            for (const item of items) {
                await this.connection.execute(
                    `INSERT INTO event_services
                        (event_id, service_id, quantity, price, duration_minutes)
                     VALUES (?, ?, ?, ?, ?)`,
                    [eventId, item.serviceId, item.quantity, item.price, item.durationMinutes]
                );
            }
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    // --- Assignments ---

    async listAssignments(eventId: number): Promise<EventAssignmentRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${ASSIGNMENT_SELECT} WHERE ea.event_id = ? ORDER BY ea.call_time, ea.id`,
                [eventId]
            );
            return rows as EventAssignmentRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async replaceAssignments(
        eventId: number,
        items: Array<{
            staffId: number;
            role: EventAssignmentRole;
            callTime: Date;
            releaseTime: Date;
            travelRequired: boolean;
            status: EventAssignmentStatus;
            commissionSharePercent: number | null;
            notes: string | null;
        }>
    ): Promise<void> {
        try {
            await this.connection.execute(
                "DELETE FROM event_staff_assignments WHERE event_id = ?",
                [eventId]
            );
            for (const item of items) {
                await this.connection.execute(
                    `INSERT INTO event_staff_assignments
                        (event_id, staff_id, role, call_time, release_time, travel_required,
                         status, commission_share_percent, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        eventId,
                        item.staffId,
                        item.role,
                        item.callTime,
                        item.releaseTime,
                        item.travelRequired ? 1 : 0,
                        item.status,
                        item.commissionSharePercent,
                        item.notes,
                    ]
                );
            }
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Event assignments for a staff member that overlap a range (including travel). */
    async listBusyEventAssignments(
        staffId: number,
        from: Date,
        to: Date,
        excludeEventId?: number
    ): Promise<BusyEventAssignmentRow[]> {
        try {
            const params: Array<number | Date> = [staffId, to, from];
            let sql = `
                SELECT ea.event_id, e.reference AS event_reference, e.title AS event_title,
                       ea.staff_id, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
                       ea.call_time, ea.release_time, ea.travel_required,
                       e.travel_buffer_minutes, ea.status
                FROM event_staff_assignments ea
                JOIN events e ON e.id = ea.event_id
                JOIN staff s ON s.id = ea.staff_id
                WHERE ea.staff_id = ?
                  AND ea.status IN ('assigned','confirmed')
                  AND e.status IN ('inquiry','confirmed','in_progress')
                  AND DATE_SUB(ea.call_time, INTERVAL e.travel_buffer_minutes MINUTE) < ?
                  AND DATE_ADD(ea.release_time, INTERVAL e.travel_buffer_minutes MINUTE) > ?`;

            if (excludeEventId !== undefined) {
                sql += " AND ea.event_id <> ?";
                params.push(excludeEventId);
            }

            sql += " ORDER BY ea.call_time";
            const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
            return rows as BusyEventAssignmentRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Assignments for one staff member across events, for the staff portal. */
    async listAssignmentsForStaff(
        staffId: number,
        from: Date,
        to: Date
    ): Promise<Array<BusyEventAssignmentRow & { role: EventAssignmentRole; venue_name: string | null; venue_address?: string | null; event_date: string; start_at: Date; end_at: Date }>> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT ea.event_id, e.reference AS event_reference, e.title AS event_title,
                        ea.staff_id, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
                        ea.role, ea.call_time, ea.release_time, ea.travel_required,
                        e.travel_buffer_minutes, ea.status,
                        v.name AS venue_name, v.address AS venue_address, e.event_date, e.start_at, e.end_at
                 FROM event_staff_assignments ea
                 JOIN events e ON e.id = ea.event_id
                 JOIN staff s ON s.id = ea.staff_id
                 LEFT JOIN venues v ON v.id = e.venue_id
                 WHERE ea.staff_id = ? AND e.start_at >= ? AND e.start_at < ?
                 ORDER BY e.start_at`,
                [staffId, from, to]
            );
            return rows as Array<
                BusyEventAssignmentRow & {
                    role: EventAssignmentRole;
                    venue_name: string | null;
                    venue_address?: string | null;
                    event_date: string;
                    start_at: Date;
                    end_at: Date;
                }
            >;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    // --- Travel itinerary ---

    async listTravelSegments(eventId: number): Promise<TravelSegmentRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT t.id, t.event_id, t.staff_id,
                        CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
                        t.sequence, t.from_label, t.to_label, t.depart_at, t.arrive_at,
                        t.mode, t.notes
                 FROM event_travel_segments t
                 LEFT JOIN staff s ON s.id = t.staff_id
                 WHERE t.event_id = ?
                 ORDER BY t.sequence, t.id`,
                [eventId]
            );
            return rows as TravelSegmentRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async replaceTravelSegments(
        eventId: number,
        items: Array<{
            staffId: number | null;
            sequence: number;
            fromLabel: string;
            toLabel: string;
            departAt: Date;
            arriveAt: Date;
            mode: string;
            notes: string | null;
        }>
    ): Promise<void> {
        try {
            await this.connection.execute(
                "DELETE FROM event_travel_segments WHERE event_id = ?",
                [eventId]
            );
            for (const item of items) {
                await this.connection.execute(
                    `INSERT INTO event_travel_segments
                        (event_id, staff_id, sequence, from_label, to_label, depart_at,
                         arrive_at, mode, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        eventId,
                        item.staffId,
                        item.sequence,
                        item.fromLabel,
                        item.toLabel,
                        item.departAt,
                        item.arriveAt,
                        item.mode,
                        item.notes,
                    ]
                );
            }
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    // --- Event supplies ---

    async listEventSupplies(eventId: number): Promise<EventSupplyRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT es.id, es.event_id, es.supply_id, s.name AS supply_name,
                        s.unit, s.category, es.planned_quantity, es.issued_quantity,
                        es.returned_quantity, es.consumed_quantity, es.status
                 FROM event_supplies es
                 JOIN supplies s ON s.id = es.supply_id
                 WHERE es.event_id = ?
                 ORDER BY s.name`,
                [eventId]
            );
            return rows as EventSupplyRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async replaceEventSupplies(
        eventId: number,
        items: Array<{ supplyId: number; plannedQuantity: number }>
    ): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM event_supplies WHERE event_id = ?", [
                eventId,
            ]);
            for (const item of items) {
                await this.connection.execute(
                    `INSERT INTO event_supplies (event_id, supply_id, planned_quantity)
                     VALUES (?, ?, ?)`,
                    [eventId, item.supplyId, item.plannedQuantity]
                );
            }
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findEventSupply(eventId: number, supplyId: number): Promise<EventSupplyRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT es.id, es.event_id, es.supply_id, s.name AS supply_name,
                        s.unit, s.category, es.planned_quantity, es.issued_quantity,
                        es.returned_quantity, es.consumed_quantity, es.status
                 FROM event_supplies es
                 JOIN supplies s ON s.id = es.supply_id
                 WHERE es.event_id = ? AND es.supply_id = ? LIMIT 1`,
                [eventId, supplyId]
            );
            return (rows[0] as EventSupplyRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateEventSupply(
        id: number,
        input: {
            issuedQuantity: number;
            returnedQuantity: number;
            consumedQuantity: number;
            status: string;
        }
    ): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE event_supplies
                 SET issued_quantity = ?, returned_quantity = ?, consumed_quantity = ?, status = ?
                 WHERE id = ?`,
                [
                    input.issuedQuantity,
                    input.returnedQuantity,
                    input.consumedQuantity,
                    input.status,
                    id,
                ]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
