import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";
import { safeRowLimit } from "../helper/sql.js";

export type SalesSummaryRow = {
    transaction_count: number;
    gross_sales: number;
    paid_total: number;
    unpaid_total: number;
    waived_total: number;
    cash_total: number;
    gcash_total: number;
    card_total: number;
    other_total: number;
    inventory_cost_total: number;
};

export type DailyClosureRow = {
    id: number;
    business_date: string;
    gross_sales: number;
    discounts: number;
    net_sales: number;
    paid_total: number;
    unpaid_total: number;
    waived_total: number;
    cash_total: number;
    gcash_total: number;
    card_total: number;
    other_total: number;
    inventory_cost_total: number;
    transaction_count: number;
    cash_counted: number | null;
    cash_variance: number | null;
    status: "open" | "closed" | "reopened";
    notes: string | null;
    closed_by: number | null;
    closed_at: Date | null;
    reopened_by: number | null;
    reopened_at: Date | null;
    reopen_reason: string | null;
    created_at: Date;
    updated_at: Date | null;
};

export type SalesReportRow = {
    bucket: string;
    staff_id: number | null;
    staff_name: string | null;
    service_id: number | null;
    service_name: string | null;
    payment_method: string | null;
    transactions: number;
    gross: number;
    paid: number;
};

export type BackfillAppointmentRow = {
    id: number;
    customer_id: number;
    staff_id: number;
    service_id: number;
    price: number;
    occurred_at: Date;
};

export type BackfillEventRow = {
    id: number;
    customer_id: number;
    staff_id: number | null;
    service_id: number | null;
    total: number;
    occurred_at: Date;
};

export type BackfillTransactionRow = {
    id: number;
    appointment_id: number | null;
    event_id: number | null;
    completed_at: Date;
};

export type MissingTransactionRow = {
    id: number;
    reference: string;
    occurred_at: Date;
    customer_name: string;
    staff_name: string;
    service_name: string | null;
    amount: number;
    kind: "appointment" | "event";
};

const CLOSURE_COLUMNS = `
    SELECT id, business_date, gross_sales, discounts, net_sales, paid_total,
           unpaid_total, waived_total, cash_total, gcash_total, card_total,
           other_total, inventory_cost_total, transaction_count,
           cash_counted, cash_variance, status, notes, closed_by, closed_at,
           reopened_by, reopened_at, reopen_reason, created_at, updated_at
    FROM daily_sales_closures
`;

export default class DailyCloseModel {
    constructor(private connection: PoolConnection) {}

    async salesSummary(from: Date, to: Date): Promise<SalesSummaryRow> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT COUNT(*) AS transaction_count,
                        COALESCE(SUM(subtotal), 0) AS gross_sales,
                        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END), 0) AS paid_total,
                        COALESCE(SUM(CASE WHEN payment_status = 'unpaid' THEN total ELSE 0 END), 0) AS unpaid_total,
                        COALESCE(SUM(CASE WHEN payment_status = 'waived' THEN total ELSE 0 END), 0) AS waived_total,
                        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END), 0) AS cash_total,
                        COALESCE(SUM(CASE WHEN payment_method = 'gcash' THEN total ELSE 0 END), 0) AS gcash_total,
                        COALESCE(SUM(CASE WHEN payment_method = 'card' THEN total ELSE 0 END), 0) AS card_total,
                        COALESCE(SUM(CASE WHEN payment_method = 'other' THEN total ELSE 0 END), 0) AS other_total,
                        COALESCE(SUM(inventory_cost_total), 0) AS inventory_cost_total
                 FROM transactions
                 WHERE completed_at >= ? AND completed_at < ?`,
                [from, to]
            );
            return rows[0] as SalesSummaryRow;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findByDate(date: string): Promise<DailyClosureRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${CLOSURE_COLUMNS} WHERE business_date = ? LIMIT 1`,
                [date]
            );
            return (rows[0] as DailyClosureRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listClosures(from: string, to: string): Promise<DailyClosureRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${CLOSURE_COLUMNS}
                 WHERE business_date >= ? AND business_date <= ?
                 ORDER BY business_date DESC`,
                [from, to]
            );
            return rows as DailyClosureRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async upsertClosure(input: {
        businessDate: string;
        grossSales: number;
        netSales: number;
        paidTotal: number;
        unpaidTotal: number;
        waivedTotal: number;
        cashTotal: number;
        gcashTotal: number;
        cardTotal: number;
        otherTotal: number;
        inventoryCostTotal: number;
        transactionCount: number;
        cashCounted: number | null;
        cashVariance: number | null;
        notes: string | null;
        closedBy: number | null;
    }): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO daily_sales_closures
                    (business_date, gross_sales, net_sales, paid_total, unpaid_total,
                     waived_total, cash_total, gcash_total, card_total, other_total,
                     inventory_cost_total, transaction_count,
                     cash_counted, cash_variance, status, notes, closed_by, closed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    gross_sales = VALUES(gross_sales), net_sales = VALUES(net_sales),
                    paid_total = VALUES(paid_total), unpaid_total = VALUES(unpaid_total),
                    waived_total = VALUES(waived_total), cash_total = VALUES(cash_total),
                    gcash_total = VALUES(gcash_total), card_total = VALUES(card_total),
                    other_total = VALUES(other_total),
                    inventory_cost_total = VALUES(inventory_cost_total),
                    transaction_count = VALUES(transaction_count),
                    cash_counted = VALUES(cash_counted), cash_variance = VALUES(cash_variance),
                    status = 'closed', notes = VALUES(notes), closed_by = VALUES(closed_by),
                    closed_at = NOW(), reopened_by = NULL, reopened_at = NULL,
                    reopen_reason = NULL,
                    id = LAST_INSERT_ID(id)`,
                [
                    input.businessDate,
                    input.grossSales,
                    input.netSales,
                    input.paidTotal,
                    input.unpaidTotal,
                    input.waivedTotal,
                    input.cashTotal,
                    input.gcashTotal,
                    input.cardTotal,
                    input.otherTotal,
                    input.inventoryCostTotal,
                    input.transactionCount,
                    input.cashCounted,
                    input.cashVariance,
                    input.notes,
                    input.closedBy,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async reopen(date: string, userId: number, reason: string): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE daily_sales_closures
                 SET status = 'reopened', reopened_by = ?, reopened_at = NOW(), reopen_reason = ?
                 WHERE business_date = ?`,
                [userId, reason, date]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async salesReport(
        from: Date,
        to: Date,
        groupBy: "day" | "week" | "month" | "staff" | "service" | "method"
    ): Promise<SalesReportRow[]> {
        try {
            // Week buckets start on Monday (WEEKDAY 0 = Monday).
            const groupColumn =
                groupBy === "day"
                    ? "DATE(t.completed_at)"
                    : groupBy === "week"
                      ? "DATE_FORMAT(DATE_SUB(t.completed_at, INTERVAL WEEKDAY(t.completed_at) DAY), '%Y-%m-%d')"
                      : groupBy === "month"
                        ? "DATE_FORMAT(t.completed_at, '%Y-%m')"
                        : groupBy === "staff"
                          ? "t.staff_id"
                          : groupBy === "service"
                            ? "t.service_id"
                            : "t.payment_method";

            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT ${groupColumn} AS bucket,
                        t.staff_id, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
                        t.service_id, sv.name AS service_name, t.payment_method,
                        COUNT(*) AS transactions,
                        COALESCE(SUM(t.total), 0) AS gross,
                        COALESCE(SUM(CASE WHEN t.payment_status = 'paid' THEN t.total ELSE 0 END), 0) AS paid
                 FROM transactions t
                 JOIN staff s ON s.id = t.staff_id
                 JOIN services sv ON sv.id = t.service_id
                 WHERE t.completed_at >= ? AND t.completed_at < ?
                 GROUP BY ${groupColumn}, t.staff_id, s.first_name, s.last_name,
                          t.service_id, sv.name, t.payment_method
                 ORDER BY bucket`,
                [from, to]
            );
            return rows as SalesReportRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Completed appointments that still need a billing transaction. */
    async backfillAppointments(): Promise<BackfillAppointmentRow[]> {
        try {
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `SELECT a.id, a.customer_id, a.staff_id, a.service_id, a.price,
                        a.start_at AS occurred_at
                 FROM appointments a
                 LEFT JOIN transactions t ON t.appointment_id = a.id
                 WHERE a.status = 'completed' AND t.id IS NULL
                 ORDER BY a.start_at`
            );
            return rows as BackfillAppointmentRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Completed events that still need a billing transaction. */
    async backfillEvents(): Promise<BackfillEventRow[]> {
        try {
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `SELECT e.id, e.customer_id, e.start_at AS occurred_at,
                        (SELECT esa.staff_id FROM event_staff_assignments esa
                         WHERE esa.event_id = e.id
                         ORDER BY CASE WHEN esa.role = 'lead' THEN 0 ELSE 1 END, esa.id
                         LIMIT 1) AS staff_id,
                        (SELECT es.service_id FROM event_services es
                         WHERE es.event_id = e.id ORDER BY es.id LIMIT 1) AS service_id,
                        COALESCE((SELECT SUM(es.price * es.quantity) FROM event_services es
                                  WHERE es.event_id = e.id), 0) AS total
                 FROM events e
                 LEFT JOIN transactions t ON t.event_id = e.id
                 WHERE e.status = 'completed' AND t.id IS NULL
                 ORDER BY e.start_at`
            );
            return rows as BackfillEventRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Completed appointments with no billing transaction. */
    async missingAppointmentTransactions(
        from: Date | null,
        to: Date | null
    ): Promise<MissingTransactionRow[]> {
        try {
            const clauses = ["a.status = 'completed'", "t.id IS NULL"];
            const params: Date[] = [];
            if (from) {
                clauses.push("a.start_at >= ?");
                params.push(from);
            }
            if (to) {
                clauses.push("a.start_at < ?");
                params.push(to);
            }
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT a.id, a.reference, a.start_at AS occurred_at,
                        CONCAT_WS(' ', c.first_name, c.last_name) AS customer_name,
                        CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
                        sv.name AS service_name, a.price AS amount
                 FROM appointments a
                 JOIN customers c ON c.id = a.customer_id
                 JOIN staff s ON s.id = a.staff_id
                 JOIN services sv ON sv.id = a.service_id
                 LEFT JOIN transactions t ON t.appointment_id = a.id
                 WHERE ${clauses.join(" AND ")}
                 ORDER BY a.start_at DESC
                 LIMIT 500`,
                params
            );
            return rows.map((row) => ({
                ...(row as MissingTransactionRow),
                kind: "appointment" as const,
            }));
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Completed events with no billing transaction. */
    async missingEventTransactions(
        from: Date | null,
        to: Date | null
    ): Promise<MissingTransactionRow[]> {
        try {
            const clauses = ["e.status = 'completed'", "t.id IS NULL"];
            const params: Date[] = [];
            if (from) {
                clauses.push("e.event_date >= ?");
                params.push(from);
            }
            if (to) {
                clauses.push("e.event_date < ?");
                params.push(to);
            }
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT e.id, e.reference, e.start_at AS occurred_at,
                        CONCAT_WS(' ', c.first_name, c.last_name) AS customer_name,
                        CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
                        NULL AS service_name,
                        COALESCE((SELECT SUM(es.price * es.quantity) FROM event_services es
                                  WHERE es.event_id = e.id), 0) AS amount
                 FROM events e
                 JOIN customers c ON c.id = e.customer_id
                 JOIN event_staff_assignments esa ON esa.event_id = e.id
                 JOIN staff s ON s.id = esa.staff_id
                 LEFT JOIN transactions t ON t.event_id = e.id
                 WHERE ${clauses.join(" AND ")}
                 GROUP BY e.id, e.reference, e.start_at, c.first_name, c.last_name,
                          s.first_name, s.last_name
                 ORDER BY e.start_at DESC
                 LIMIT 500`,
                params
            );
            return rows.map((row) => ({
                ...(row as MissingTransactionRow),
                kind: "event" as const,
            }));
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

}

void safeRowLimit;
