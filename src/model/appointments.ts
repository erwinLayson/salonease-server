import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";
import type { PaymentStatus } from "./transactions.js";

export type AppointmentStatus =
    | "pending"
    | "confirmed"
    | "completed"
    | "cancelled"
    | "no_show";

export type AppointmentRow = {
    id: number;
    reference: string;
    manage_token: string;
    customer_id: number;
    staff_id: number;
    service_id: number;
    start_at: Date;
    end_at: Date;
    buffer_end_at: Date;
    price: number;
    status: AppointmentStatus;
    source: "online" | "manual";
    notes: string | null;
    created_by: number | null;
    created_at: Date;
    updated_at: Date | null;
};

/** Appointment plus joined customer/staff/service details for the manage page. */
export type ManagedAppointmentRow = AppointmentRow & {
    customer_first_name: string;
    customer_last_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    staff_first_name: string;
    staff_last_name: string;
    service_name: string;
    service_duration_minutes: number;
    /** Payment status of the linked transaction (null before completion). */
    payment_status: PaymentStatus | null;
};

/** Minimal shape needed to test whether a time is occupied. */
export type BusyAppointment = {
    id: number;
    start_at: Date;
    buffer_end_at: Date;
};

/** Filters for the owner appointment list. All are optional. */
export type AppointmentFilter = {
    from?: Date | null;
    to?: Date | null;
    staffId?: number | null;
    status?: AppointmentStatus | null;
    /** Partial match on reference or customer name/phone. */
    search?: string | null;
    limit?: number;
};

/** New schedule values when an appointment is rescheduled. */
export type UpdateScheduleInput = {
    staffId: number;
    serviceId: number;
    startAt: Date;
    endAt: Date;
    bufferEndAt: Date;
    price: number;
};

export type InsertAppointmentInput = {
    reference: string;
    manageToken: string;
    customerId: number;
    staffId: number;
    serviceId: number;
    startAt: Date;
    endAt: Date;
    bufferEndAt: Date;
    price: number;
    status: AppointmentStatus;
    source: "online" | "manual";
    createdBy: number | null;
};

const SELECT_COLUMNS = `
    SELECT id, reference, manage_token, customer_id, staff_id, service_id,
           start_at, end_at, buffer_end_at, price, status, source, notes,
           created_by, created_at, updated_at
    FROM appointments
`;

/** Appointment joined with customer, staff and service details. */
const DETAIL_SELECT = `
    SELECT a.id, a.reference, a.manage_token, a.customer_id, a.staff_id, a.service_id,
           a.start_at, a.end_at, a.buffer_end_at, a.price, a.status, a.source, a.notes,
           a.created_by, a.created_at, a.updated_at,
           c.first_name AS customer_first_name,
           c.last_name  AS customer_last_name,
           c.phone      AS customer_phone,
           c.email      AS customer_email,
           s.first_name AS staff_first_name,
           s.last_name  AS staff_last_name,
           sv.name      AS service_name,
           sv.duration_minutes AS service_duration_minutes,
           tx.payment_status AS payment_status
    FROM appointments a
    JOIN customers c ON c.id = a.customer_id
    JOIN staff s     ON s.id = a.staff_id
    JOIN services sv ON sv.id = a.service_id
    LEFT JOIN transactions tx ON tx.appointment_id = a.id
`;

export default class AppointmentModel {
    constructor(private connection: PoolConnection) {}

    /**
     * Serializes bookings for a staff member by locking their row.
     * Must be called inside a transaction. This is the primary guard against
     * two simultaneous requests booking the same staff + time slot.
     */
    async lockStaffRow(staffId: number): Promise<void> {
        try {
            await this.connection.execute("SELECT id FROM staff WHERE id = ? FOR UPDATE", [
                staffId,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * Finds an active appointment on `staffId` whose occupied interval
     * [start_at, buffer_end_at) overlaps [start, bufferEnd).
     *
     * Uses a locking read (`FOR UPDATE`) so that, under REPEATABLE READ, the check
     * sees the latest committed rows rather than a stale transaction snapshot.
     * Must be called inside the booking transaction, after `lockStaffRow`.
     */
    async findOverlap(
        staffId: number,
        start: Date,
        bufferEnd: Date,
        excludeAppointmentId?: number
    ): Promise<BusyAppointment | null> {
        try {
            const params: Array<string | number | Date | null> = [staffId, bufferEnd, start];
            let sql = `
                SELECT id, start_at, buffer_end_at FROM appointments
                WHERE staff_id = ? AND status IN ('pending','confirmed')
                  AND start_at < ? AND buffer_end_at > ?`;

            if (excludeAppointmentId !== undefined) {
                sql += " AND id <> ?";
                params.push(excludeAppointmentId);
            }

            sql += " LIMIT 1 FOR UPDATE";

            const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
            return (rows[0] as BusyAppointment | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * Active appointments that could occupy time within [from, to).
     * `excludeAppointmentId` omits one appointment (used when re-checking the
     * same booking during a reschedule).
     */
    async listBusy(
        staffId: number,
        from: Date,
        to: Date,
        excludeAppointmentId?: number
    ): Promise<BusyAppointment[]> {
        try {
            const params: Array<string | number | Date | null> = [staffId, to, from];
            let sql = `SELECT id, start_at, buffer_end_at FROM appointments
                 WHERE staff_id = ? AND status IN ('pending','confirmed')
                   AND start_at < ? AND buffer_end_at > ?`;

            if (excludeAppointmentId !== undefined) {
                sql += " AND id <> ?";
                params.push(excludeAppointmentId);
            }

            sql += " ORDER BY start_at";

            const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
            return rows as BusyAppointment[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * Active appointments overlapping [from, to) — used to warn when
     * blocking time (leave/closure) over existing bookings.
     * `staffId` null = any staff member (salon-wide closures).
     */
    async listOverlapping(
        from: Date,
        to: Date,
        staffId: number | null
    ): Promise<ManagedAppointmentRow[]> {
        try {
            const params: Array<string | number | Date> = [to, from];
            let sql = `${DETAIL_SELECT}
                 WHERE a.status IN ('pending','confirmed')
                   AND a.start_at < ? AND a.buffer_end_at > ?`;

            if (staffId !== null) {
                sql += " AND a.staff_id = ?";
                params.push(staffId);
            }

            sql += " ORDER BY a.start_at";

            const [rows] = await this.connection.execute<RowDataPacket[]>(sql, params);
            return rows as ManagedAppointmentRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async insert(input: InsertAppointmentInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO appointments
                    (reference, manage_token, customer_id, staff_id, service_id,
                     start_at, end_at, buffer_end_at, price, status, source, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    input.reference,
                    input.manageToken,
                    input.customerId,
                    input.staffId,
                    input.serviceId,
                    input.startAt,
                    input.endAt,
                    input.bufferEndAt,
                    input.price,
                    input.status,
                    input.source,
                    input.createdBy,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findById(id: number): Promise<AppointmentRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_COLUMNS} WHERE id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as AppointmentRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Looks up an appointment by its (unguessable) manage token. */
    async findByManageToken(token: string): Promise<AppointmentRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_COLUMNS} WHERE manage_token = ? LIMIT 1`,
                [token]
            );
            return (rows[0] as AppointmentRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Appointment joined with the customer, staff, and service for the manage page. */
    async findManagedByToken(token: string): Promise<ManagedAppointmentRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${DETAIL_SELECT} WHERE a.manage_token = ? LIMIT 1`,
                [token]
            );
            return (rows[0] as ManagedAppointmentRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Appointment with joined details, by primary key (owner/staff views). */
    async findByIdWithDetails(id: number): Promise<ManagedAppointmentRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${DETAIL_SELECT} WHERE a.id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as ManagedAppointmentRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Owner appointment list with optional date/staff/status/search filters. */
    async listAppointments(filter: AppointmentFilter): Promise<ManagedAppointmentRow[]> {
        try {
            const clauses: string[] = [];
            const params: Array<string | number | Date | null> = [];

            if (filter.from) {
                clauses.push("a.start_at >= ?");
                params.push(filter.from);
            }
            if (filter.to) {
                clauses.push("a.start_at < ?");
                params.push(filter.to);
            }
            if (filter.staffId) {
                clauses.push("a.staff_id = ?");
                params.push(filter.staffId);
            }
            if (filter.status) {
                clauses.push("a.status = ?");
                params.push(filter.status);
            }
            if (filter.search) {
                const like = `%${filter.search}%`;
                clauses.push(
                    "(a.reference LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?)"
                );
                params.push(like, like, like, like);
            }

            const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
            params.push(filter.limit ?? 200);

            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${DETAIL_SELECT} ${where} ORDER BY a.start_at LIMIT ?`,
                params
            );
            return rows as ManagedAppointmentRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Appointments for one staff member within [from, to) (schedule views). */
    async listForStaffBetween(
        staffId: number,
        from: Date,
        to: Date
    ): Promise<ManagedAppointmentRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${DETAIL_SELECT}
                 WHERE a.staff_id = ? AND a.start_at >= ? AND a.start_at < ?
                 ORDER BY a.start_at`,
                [staffId, from, to]
            );
            return rows as ManagedAppointmentRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Updates the status (and cancellation metadata when cancelling). */
    async updateStatus(
        id: number,
        status: AppointmentStatus,
        options: { reason?: string | null } = {}
    ): Promise<void> {
        try {
            if (status === "cancelled") {
                await this.connection.execute(
                    `UPDATE appointments
                     SET status = ?, cancelled_at = NOW(), cancelled_reason = ?
                     WHERE id = ?`,
                    [status, options.reason ?? null, id]
                );
                return;
            }

            await this.connection.execute("UPDATE appointments SET status = ? WHERE id = ?", [
                status,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Overwrites the appointment's time/staff/service (owner reschedule). */
    async updateSchedule(id: number, input: UpdateScheduleInput): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE appointments
                 SET staff_id = ?, service_id = ?, start_at = ?, end_at = ?, buffer_end_at = ?, price = ?
                 WHERE id = ?`,
                [
                    input.staffId,
                    input.serviceId,
                    input.startAt,
                    input.endAt,
                    input.bufferEndAt,
                    input.price,
                    id,
                ]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Replaces the free-text notes on an appointment. */
    async updateNotes(id: number, notes: string | null): Promise<void> {
        try {
            await this.connection.execute("UPDATE appointments SET notes = ? WHERE id = ?", [
                notes,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Appends a line to the appointment notes (used for reschedule requests). */
    async appendNote(id: number, note: string): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE appointments SET notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?",
                [note, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
