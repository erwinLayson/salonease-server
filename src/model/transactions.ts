import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";
import { safeRowLimit } from "../helper/sql.js";

export type PaymentMethod = "cash" | "gcash" | "card" | "other";
export type PaymentStatus = "paid" | "unpaid" | "waived";

export interface TransactionRow {
    id: number;
    reference: string;
    appointment_id: number;
    customer_id: number;
    staff_id: number;
    service_id: number;
    subtotal: number;
    total: number;
    payment_method: PaymentMethod;
    payment_status: PaymentStatus;
    notes: string | null;
    completed_at: Date;
    created_at: Date;
    updated_at: Date | null;
}

/** Transaction with joined customer, staff and service details. */
export interface TransactionDetailRow extends TransactionRow {
    customer_first_name: string;
    customer_last_name: string | null;
    customer_phone: string | null;
    customer_email: string | null;
    staff_first_name: string;
    staff_last_name: string;
    service_name: string;
    appointment_reference: string;
}

export interface InsertTransactionInput {
    reference: string;
    appointmentId: number;
    customerId: number;
    staffId: number;
    serviceId: number;
    subtotal: number;
    total: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    completedAt: Date;
    notes?: string | null;
}

export interface TransactionFilter {
    from?: Date | null;
    to?: Date | null;
    staffId?: number | null;
    paymentMethod?: PaymentMethod | null;
    paymentStatus?: PaymentStatus | null;
    search?: string | null;
    limit?: number;
}

export interface UpdateTransactionInput {
    paymentMethod?: PaymentMethod;
    paymentStatus?: PaymentStatus;
    notes?: string | null;
}

/** One month of the yearly report. */
export interface YearlyMonthRow {
    month: number; // 1–12
    bookings: number;
    revenue: number;
}

/** One service's booking frequency for the yearly report. */
export interface YearlyServiceRow {
    serviceId: number;
    name: string;
    bookings: number;
    revenue: number;
}

/** Yearly performance report for the owner. */
export interface YearlyReportRow {
    year: number;
    months: YearlyMonthRow[];
    topServices: YearlyServiceRow[];
    /** Years that have at least one transaction, newest first. */
    years: number[];
    totalRevenue: number;
    totalBookings: number;
    averageTicket: number;
}

const DETAIL_SELECT = `
    SELECT t.id, t.reference, t.appointment_id, t.customer_id, t.staff_id, t.service_id,
           t.subtotal, t.total, t.payment_method, t.payment_status,
           t.notes, t.completed_at, t.created_at, t.updated_at,
           c.first_name AS customer_first_name,
           c.last_name  AS customer_last_name,
           c.phone      AS customer_phone,
           c.email      AS customer_email,
           s.first_name AS staff_first_name,
           s.last_name  AS staff_last_name,
           sv.name      AS service_name,
           a.reference  AS appointment_reference
    FROM transactions t
    JOIN customers c   ON c.id  = t.customer_id
    JOIN staff s       ON s.id  = t.staff_id
    JOIN services sv   ON sv.id = t.service_id
    JOIN appointments a ON a.id = t.appointment_id
`;

export default class TransactionModel {
    constructor(private connection: PoolConnection) {}

    async insert(input: InsertTransactionInput): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO transactions
                    (reference, appointment_id, customer_id, staff_id, service_id,
                     subtotal, total, payment_method, payment_status, completed_at, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    input.reference,
                    input.appointmentId,
                    input.customerId,
                    input.staffId,
                    input.serviceId,
                    input.subtotal,
                    input.total,
                    input.paymentMethod,
                    input.paymentStatus,
                    input.completedAt,
                    input.notes ?? null,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findById(id: number): Promise<TransactionDetailRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${DETAIL_SELECT} WHERE t.id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as TransactionDetailRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findByAppointmentId(appointmentId: number): Promise<TransactionDetailRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${DETAIL_SELECT} WHERE t.appointment_id = ? LIMIT 1`,
                [appointmentId]
            );
            return (rows[0] as TransactionDetailRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async list(filter: TransactionFilter): Promise<TransactionDetailRow[]> {
        try {
            const clauses: string[] = [];
            const params: Array<string | number | Date | null> = [];

            if (filter.from) {
                clauses.push("t.completed_at >= ?");
                params.push(filter.from);
            }
            if (filter.to) {
                clauses.push("t.completed_at < ?");
                params.push(filter.to);
            }
            if (filter.staffId) {
                clauses.push("t.staff_id = ?");
                params.push(filter.staffId);
            }
            if (filter.paymentMethod) {
                clauses.push("t.payment_method = ?");
                params.push(filter.paymentMethod);
            }
            if (filter.paymentStatus) {
                clauses.push("t.payment_status = ?");
                params.push(filter.paymentStatus);
            }
            if (filter.search) {
                const like = `%${filter.search}%`;
                clauses.push(
                    "(t.reference LIKE ? OR a.reference LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)"
                );
                params.push(like, like, like, like);
            }

            const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
            // Inlined (not a `?` parameter): TiDB rejects placeholders in LIMIT.
            const limit = safeRowLimit(filter.limit);

            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${DETAIL_SELECT} ${where} ORDER BY t.completed_at DESC LIMIT ${limit}`,
                params
            );
            return rows as TransactionDetailRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async update(id: number, input: UpdateTransactionInput): Promise<void> {
        try {
            const sets: string[] = [];
            const params: Array<string | number | null> = [];

            if (input.paymentMethod !== undefined) {
                sets.push("payment_method = ?");
                params.push(input.paymentMethod);
            }
            if (input.paymentStatus !== undefined) {
                sets.push("payment_status = ?");
                params.push(input.paymentStatus);
            }
            if (input.notes !== undefined) {
                sets.push("notes = ?");
                params.push(input.notes);
            }

            if (sets.length === 0) return;

            params.push(id);
            await this.connection.execute(
                `UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`,
                params
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Revenue totals for the dashboard summary (today's completed + paid). */
    async summary(from: Date, to: Date): Promise<{ count: number; total: number }> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
                 FROM transactions
                 WHERE completed_at >= ? AND completed_at < ?`,
                [from, to]
            );
            const row = rows[0] as { count: number; total: number };
            return { count: Number(row.count), total: Number(row.total) };
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /**
     * Yearly performance report: monthly revenue/bookings, the most
     * frequently booked services, and every year that has data (for
     * the year filter). Months with no activity are included as zeros
     * so the client can chart a full year.
     */
    async yearlyReport(year: number): Promise<YearlyReportRow> {
        try {
            const from = new Date(year, 0, 1);
            const to = new Date(year + 1, 0, 1);
            const range: Array<Date> = [from, to];

            const [monthRows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT MONTH(completed_at) AS month,
                        COUNT(*) AS bookings,
                        COALESCE(SUM(total), 0) AS revenue
                 FROM transactions
                 WHERE completed_at >= ? AND completed_at < ?
                 GROUP BY MONTH(completed_at)`,
                range
            );

            const [serviceRows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT t.service_id AS service_id, sv.name AS name,
                        COUNT(*) AS bookings,
                        COALESCE(SUM(t.total), 0) AS revenue
                 FROM transactions t
                 JOIN services sv ON sv.id = t.service_id
                 WHERE t.completed_at >= ? AND t.completed_at < ?
                 GROUP BY t.service_id, sv.name
                 ORDER BY bookings DESC, revenue DESC
                 LIMIT 8`,
                range
            );

            const [yearRows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT DISTINCT YEAR(completed_at) AS year
                 FROM transactions
                 ORDER BY year DESC`
            );

            const months: YearlyMonthRow[] = Array.from(
                { length: 12 },
                (_, index) => ({ month: index + 1, bookings: 0, revenue: 0 })
            );
            for (const row of monthRows) {
                const index = Number(row.month) - 1;
                if (index >= 0 && index < 12) {
                    months[index] = {
                        month: index + 1,
                        bookings: Number(row.bookings),
                        revenue: Number(row.revenue),
                    };
                }
            }

            const totalBookings = months.reduce((sum, m) => sum + m.bookings, 0);
            const totalRevenue = months.reduce((sum, m) => sum + m.revenue, 0);

            return {
                year,
                months,
                topServices: serviceRows.map((row) => ({
                    serviceId: Number(row.service_id),
                    name: String(row.name),
                    bookings: Number(row.bookings),
                    revenue: Number(row.revenue),
                })),
                years: yearRows.map((row) => Number(row.year)),
                totalRevenue,
                totalBookings,
                averageTicket: totalBookings > 0 ? totalRevenue / totalBookings : 0,
            };
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
