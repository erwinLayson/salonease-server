import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";

// Types
import type { QueueStatus } from "../constant/queue.js";

export type WalkInTicketRow = {
    id: number;
    queue_date: string;
    ticket_number: number;
    customer_name: string;
    customer_phone: string | null;
    service_id: number;
    service_name: string;
    service_duration_minutes: number;
    preferred_staff_id: number | null;
    preferred_staff_name: string | null;
    assigned_staff_id: number | null;
    assigned_staff_name: string | null;
    status: QueueStatus;
    checked_in_at: Date;
    called_at: Date | null;
    started_at: Date | null;
    completed_at: Date | null;
    estimated_wait_minutes: number | null;
    appointment_id: number | null;
    notes: string | null;
    created_by: number | null;
    created_at: Date;
    updated_at: Date | null;
};

export type QueueEstimateRow = {
    id: number;
    ticket_number: number;
    status: QueueStatus;
    service_duration_minutes: number;
    started_at: Date | null;
};

export type WaitTimeRow = {
    bucket: string;
    tickets: number;
    served: number;
    avg_wait_minutes: number;
    longest_wait_minutes: number;
};

export type WaitTimeStaffRow = WaitTimeRow & {
    staff_id: number | null;
    staff_name: string | null;
};

export type InsertQueueTicketInput = {
    queueDate: string;
    ticketNumber: number;
    customerName: string;
    customerPhone: string | null;
    serviceId: number;
    preferredStaffId: number | null;
    assignedStaffId: number | null;
    checkedInAt: Date;
    estimatedWaitMinutes: number | null;
    notes: string | null;
    createdBy: number | null;
};

const SELECT_TICKET = `
    SELECT q.id, q.queue_date, q.ticket_number, q.customer_name, q.customer_phone,
           q.service_id, sv.name AS service_name, sv.duration_minutes AS service_duration_minutes,
           q.preferred_staff_id, ps.first_name AS preferred_staff_first,
           ps.last_name AS preferred_staff_last,
           q.assigned_staff_id, ast.first_name AS assigned_staff_first,
           ast.last_name AS assigned_staff_last,
           q.status, q.checked_in_at, q.called_at, q.started_at, q.completed_at,
           q.estimated_wait_minutes, q.appointment_id, q.notes, q.created_by,
           q.created_at, q.updated_at
    FROM walk_in_queue q
    JOIN services sv ON sv.id = q.service_id
    LEFT JOIN staff ps ON ps.id = q.preferred_staff_id
    LEFT JOIN staff ast ON ast.id = q.assigned_staff_id
`;

const fullName = (first: string | null, last: string | null): string | null => {
    if (!first) return null;
    return [first, last].filter(Boolean).join(" ").trim();
};

const toRow = (raw: RowDataPacket): WalkInTicketRow => ({
    id: raw.id,
    queue_date: raw.queue_date,
    ticket_number: raw.ticket_number,
    customer_name: raw.customer_name,
    customer_phone: raw.customer_phone,
    service_id: raw.service_id,
    service_name: raw.service_name,
    service_duration_minutes: raw.service_duration_minutes,
    preferred_staff_id: raw.preferred_staff_id,
    preferred_staff_name: fullName(raw.preferred_staff_first, raw.preferred_staff_last),
    assigned_staff_id: raw.assigned_staff_id,
    assigned_staff_name: fullName(raw.assigned_staff_first, raw.assigned_staff_last),
    status: raw.status,
    checked_in_at: raw.checked_in_at,
    called_at: raw.called_at,
    started_at: raw.started_at,
    completed_at: raw.completed_at,
    estimated_wait_minutes: raw.estimated_wait_minutes,
    appointment_id: raw.appointment_id,
    notes: raw.notes,
    created_by: raw.created_by,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
});

export default class QueueModel {
    constructor(private connection: PoolConnection) {}

    async listByDate(queueDate: string): Promise<WalkInTicketRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_TICKET}
                 WHERE q.queue_date = ?
                 ORDER BY q.ticket_number`,
                [queueDate]
            );
            return rows.map(toRow);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findById(id: number): Promise<WalkInTicketRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SELECT_TICKET} WHERE q.id = ? LIMIT 1`,
                [id]
            );
            return rows[0] ? toRow(rows[0]) : null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Highest ticket number for a date (0 when none exist). */
    async maxTicketNumber(queueDate: string): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT COALESCE(MAX(ticket_number), 0) AS max_number FROM walk_in_queue WHERE queue_date = ?",
                [queueDate]
            );
            return Number(rows[0]?.max_number ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async insert(input: InsertQueueTicketInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO walk_in_queue
                    (queue_date, ticket_number, customer_name, customer_phone, service_id,
                     preferred_staff_id, assigned_staff_id, status, checked_in_at,
                     estimated_wait_minutes, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?)`,
                [
                    input.queueDate,
                    input.ticketNumber,
                    input.customerName,
                    input.customerPhone,
                    input.serviceId,
                    input.preferredStaffId,
                    input.assignedStaffId,
                    input.checkedInAt,
                    input.estimatedWaitMinutes,
                    input.notes,
                    input.createdBy,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateStatus(id: number, status: QueueStatus): Promise<void> {
        try {
            const timestampColumn =
                status === "called"
                    ? ", called_at = NOW()"
                    : status === "in_service"
                      ? ", started_at = NOW()"
                      : status === "completed" || status === "cancelled" || status === "no_show"
                        ? ", completed_at = NOW()"
                        : "";

            await this.connection.execute(
                `UPDATE walk_in_queue SET status = ?${timestampColumn} WHERE id = ?`,
                [status, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateAssignment(id: number, staffId: number | null): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE walk_in_queue SET assigned_staff_id = ? WHERE id = ?",
                [staffId, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateEstimate(id: number, minutes: number | null): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE walk_in_queue SET estimated_wait_minutes = ? WHERE id = ?",
                [minutes, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async attachAppointment(id: number, appointmentId: number): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE walk_in_queue SET appointment_id = ? WHERE id = ?",
                [appointmentId, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Active staff who can absorb queue work (minimum 1 for ETA maths). */
    async countActiveStaff(): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT COUNT(*) AS total FROM staff WHERE is_active = 1"
            );
            return Math.max(1, Number(rows[0]?.total ?? 0));
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Active staff who can perform a service (minimum 1 for ETA maths). */
    async countActiveStaffForService(serviceId: number): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT COUNT(*) AS total
                 FROM staff s
                 JOIN staff_services ss ON ss.staff_id = s.id
                 WHERE ss.service_id = ? AND s.is_active = 1`,
                [serviceId]
            );
            return Math.max(1, Number(rows[0]?.total ?? 0));
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * Wait-time metrics per business date. A ticket's wait is the minutes from
     * check-in to the start of the service; cancelled tickets are excluded and
     * no-shows count as tickets but not as served.
     */
    async waitTimeByDay(from: string, to: string): Promise<WaitTimeRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT DATE(q.queue_date) AS bucket,
                        COUNT(*) AS tickets,
                        COUNT(q.started_at) AS served,
                        COALESCE(AVG(CASE WHEN q.started_at IS NOT NULL
                            THEN TIMESTAMPDIFF(MINUTE, q.checked_in_at, q.started_at) END), 0) AS avg_wait_minutes,
                        COALESCE(MAX(CASE WHEN q.started_at IS NOT NULL
                            THEN TIMESTAMPDIFF(MINUTE, q.checked_in_at, q.started_at) END), 0) AS longest_wait_minutes
                 FROM walk_in_queue q
                 WHERE q.queue_date >= ? AND q.queue_date <= ?
                   AND q.status <> 'cancelled'
                 GROUP BY DATE(q.queue_date)
                 ORDER BY bucket`,
                [from, to]
            );
            return rows as WaitTimeRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Wait-time metrics per assigned staff member over a date range. */
    async waitTimeByStaff(from: string, to: string): Promise<WaitTimeStaffRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT CAST(q.assigned_staff_id AS CHAR) AS bucket,
                        q.assigned_staff_id AS staff_id,
                        CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
                        COUNT(*) AS tickets,
                        COUNT(q.started_at) AS served,
                        COALESCE(AVG(CASE WHEN q.started_at IS NOT NULL
                            THEN TIMESTAMPDIFF(MINUTE, q.checked_in_at, q.started_at) END), 0) AS avg_wait_minutes,
                        COALESCE(MAX(CASE WHEN q.started_at IS NOT NULL
                            THEN TIMESTAMPDIFF(MINUTE, q.checked_in_at, q.started_at) END), 0) AS longest_wait_minutes
                 FROM walk_in_queue q
                 LEFT JOIN staff s ON s.id = q.assigned_staff_id
                 WHERE q.queue_date >= ? AND q.queue_date <= ?
                   AND q.status <> 'cancelled'
                 GROUP BY q.assigned_staff_id, s.first_name, s.last_name
                 ORDER BY staff_name`,
                [from, to]
            );
            return rows as WaitTimeStaffRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Waiting/in-service tickets needed to estimate the queue. */
    async listForEstimate(queueDate: string): Promise<QueueEstimateRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT q.id, q.ticket_number, q.status, q.started_at,
                        sv.duration_minutes AS service_duration_minutes
                 FROM walk_in_queue q
                 JOIN services sv ON sv.id = q.service_id
                 WHERE q.queue_date = ? AND q.status IN ('waiting','called','in_service')
                 ORDER BY q.ticket_number`,
                [queueDate]
            );
            return rows as QueueEstimateRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
