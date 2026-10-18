import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError } from "../helper/error.js";
import { safeRowLimit } from "../helper/sql.js";

// Types
import type { CommissionRateType } from "../service/commissionRules.js";

export type CommissionRuleRow = {
    id: number;
    staff_id: number | null;
    service_id: number | null;
    service_category: string | null;
    rate_type: CommissionRateType;
    rate_value: number;
    effective_from: string;
    effective_to: string | null;
    priority: number;
    is_active: number;
    notes: string | null;
};

export type CommissionEntryRow = {
    id: number;
    source_type: "appointment" | "event";
    source_id: number;
    transaction_id: number | null;
    event_id: number | null;
    staff_id: number;
    staff_name: string;
    service_id: number | null;
    service_name: string | null;
    base_amount: number;
    rate_type: CommissionRateType;
    rate_value: number;
    commission_amount: number;
    status: "accrued" | "approved" | "paid" | "void";
    payout_id: number | null;
    accrued_at: Date;
    notes: string | null;
    transaction_reference: string | null;
    event_reference: string | null;
};

export type CommissionPayoutRow = {
    id: number;
    staff_id: number;
    staff_name: string;
    period_start: string;
    period_end: string;
    total_amount: number;
    status: "draft" | "approved" | "paid" | "void";
    payment_method: string | null;
    paid_at: Date | null;
    notes: string | null;
    created_by: number | null;
    created_at: Date;
    updated_at: Date | null;
};

const RULE_COLUMNS = `
    SELECT id, staff_id, service_id, service_category, rate_type, rate_value,
           effective_from, effective_to, priority, is_active, notes
    FROM commission_rules
`;

const ENTRY_SELECT = `
    SELECT ce.id, ce.source_type, ce.source_id, ce.transaction_id, ce.event_id,
           ce.staff_id, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
           ce.service_id, sv.name AS service_name, ce.base_amount, ce.rate_type,
           ce.rate_value, ce.commission_amount, ce.status, ce.payout_id,
           ce.accrued_at, ce.notes,
           t.reference AS transaction_reference,
           e.reference AS event_reference
    FROM commission_entries ce
    JOIN staff s ON s.id = ce.staff_id
    LEFT JOIN services sv ON sv.id = ce.service_id
    LEFT JOIN transactions t ON t.id = ce.transaction_id
    LEFT JOIN events e ON e.id = ce.event_id
`;

const PAYOUT_SELECT = `
    SELECT p.id, p.staff_id, CONCAT_WS(' ', s.first_name, s.last_name) AS staff_name,
           p.period_start, p.period_end, p.total_amount, p.status, p.payment_method,
           p.paid_at, p.notes, p.created_by, p.created_at, p.updated_at
    FROM commission_payouts p
    JOIN staff s ON s.id = p.staff_id
`;

export default class CommissionModel {
    constructor(private connection: PoolConnection) {}

    async listRules(includeInactive: boolean): Promise<CommissionRuleRow[]> {
        try {
            const where = includeInactive ? "" : "WHERE is_active = 1";
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `${RULE_COLUMNS} ${where} ORDER BY priority DESC, effective_from DESC, id DESC`
            );
            return rows as CommissionRuleRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findRuleById(id: number): Promise<CommissionRuleRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${RULE_COLUMNS} WHERE id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as CommissionRuleRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async createRule(input: {
        staffId: number | null;
        serviceId: number | null;
        serviceCategory: string | null;
        rateType: CommissionRateType;
        rateValue: number;
        effectiveFrom: string;
        effectiveTo: string | null;
        priority: number;
        notes: string | null;
    }): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO commission_rules
                    (staff_id, service_id, service_category, rate_type, rate_value,
                     effective_from, effective_to, priority, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    input.staffId,
                    input.serviceId,
                    input.serviceCategory,
                    input.rateType,
                    input.rateValue,
                    input.effectiveFrom,
                    input.effectiveTo,
                    input.priority,
                    input.notes,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateRule(
        id: number,
        input: {
            staffId: number | null;
            serviceId: number | null;
            serviceCategory: string | null;
            rateType: CommissionRateType;
            rateValue: number;
            effectiveFrom: string;
            effectiveTo: string | null;
            priority: number;
            notes: string | null;
            isActive: boolean;
        }
    ): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE commission_rules
                 SET staff_id = ?, service_id = ?, service_category = ?, rate_type = ?,
                     rate_value = ?, effective_from = ?, effective_to = ?, priority = ?,
                     notes = ?, is_active = ?
                 WHERE id = ?`,
                [
                    input.staffId,
                    input.serviceId,
                    input.serviceCategory,
                    input.rateType,
                    input.rateValue,
                    input.effectiveFrom,
                    input.effectiveTo,
                    input.priority,
                    input.notes,
                    input.isActive ? 1 : 0,
                    id,
                ]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async deleteRule(id: number): Promise<void> {
        try {
            await this.connection.execute("DELETE FROM commission_rules WHERE id = ?", [id]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listActiveRules(): Promise<CommissionRuleRow[]> {
        try {
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `${RULE_COLUMNS} WHERE is_active = 1 ORDER BY priority DESC, effective_from DESC, id DESC`
            );
            return rows as CommissionRuleRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findEntry(
        sourceType: "appointment" | "event",
        sourceId: number,
        staffId: number
    ): Promise<CommissionEntryRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${ENTRY_SELECT}
                 WHERE ce.source_type = ? AND ce.source_id = ? AND ce.staff_id = ?
                 LIMIT 1`,
                [sourceType, sourceId, staffId]
            );
            return (rows[0] as CommissionEntryRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async insertEntry(input: {
        sourceType: "appointment" | "event";
        sourceId: number;
        transactionId: number | null;
        eventId: number | null;
        staffId: number;
        serviceId: number | null;
        baseAmount: number;
        rateType: CommissionRateType;
        rateValue: number;
        commissionAmount: number;
        accruedAt: Date;
        notes: string | null;
    }): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO commission_entries
                    (source_type, source_id, transaction_id, event_id, staff_id, service_id,
                     base_amount, rate_type, rate_value, commission_amount, accrued_at, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    input.sourceType,
                    input.sourceId,
                    input.transactionId,
                    input.eventId,
                    input.staffId,
                    input.serviceId,
                    input.baseAmount,
                    input.rateType,
                    input.rateValue,
                    input.commissionAmount,
                    input.accruedAt,
                    input.notes,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listEntries(filter: {
        from?: Date | null;
        to?: Date | null;
        staffId?: number | null;
        status?: string | null;
        limit?: number;
    }): Promise<CommissionEntryRow[]> {
        try {
            const clauses: string[] = [];
            const params: Array<string | number | Date> = [];

            if (filter.from) {
                clauses.push("ce.accrued_at >= ?");
                params.push(filter.from);
            }
            if (filter.to) {
                clauses.push("ce.accrued_at < ?");
                params.push(filter.to);
            }
            if (filter.staffId) {
                clauses.push("ce.staff_id = ?");
                params.push(filter.staffId);
            }
            if (filter.status) {
                clauses.push("ce.status = ?");
                params.push(filter.status);
            }

            const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
            const limit = safeRowLimit(filter.limit, 500);
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${ENTRY_SELECT} ${where} ORDER BY ce.accrued_at DESC, ce.id DESC LIMIT ${limit}`,
                params
            );
            return rows as CommissionEntryRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async sumForTransaction(transactionId: number): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT COALESCE(SUM(commission_amount), 0) AS total
                 FROM commission_entries
                 WHERE transaction_id = ? AND status <> 'void'`,
                [transactionId]
            );
            return Number(rows[0]?.total ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async sumEntriesForPeriod(
        staffId: number,
        from: string,
        to: string
    ): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT COALESCE(SUM(commission_amount), 0) AS total
                 FROM commission_entries
                 WHERE staff_id = ? AND status IN ('accrued','approved')
                   AND DATE(accrued_at) >= ? AND DATE(accrued_at) <= ?`,
                [staffId, from, to]
            );
            return Number(rows[0]?.total ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async createPayout(input: {
        staffId: number;
        periodStart: string;
        periodEnd: string;
        totalAmount: number;
        notes: string | null;
        createdBy: number | null;
    }): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO commission_payouts
                    (staff_id, period_start, period_end, total_amount, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    input.staffId,
                    input.periodStart,
                    input.periodEnd,
                    input.totalAmount,
                    input.notes,
                    input.createdBy,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listPayouts(): Promise<CommissionPayoutRow[]> {
        try {
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `${PAYOUT_SELECT} ORDER BY p.period_end DESC, p.id DESC`
            );
            return rows as CommissionPayoutRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findPayoutById(id: number): Promise<CommissionPayoutRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${PAYOUT_SELECT} WHERE p.id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as CommissionPayoutRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updatePayoutStatus(
        id: number,
        status: string,
        paymentMethod: string | null
    ): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE commission_payouts
                 SET status = ?, payment_method = ?,
                     paid_at = CASE WHEN ? = 'paid' THEN NOW() ELSE paid_at END
                 WHERE id = ?`,
                [status, paymentMethod, status, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async assignEntriesToPayout(
        staffId: number,
        from: string,
        to: string,
        payoutId: number
    ): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE commission_entries
                 SET payout_id = ?, status = 'paid'
                 WHERE staff_id = ? AND status IN ('accrued','approved')
                   AND DATE(accrued_at) >= ? AND DATE(accrued_at) <= ?`,
                [payoutId, staffId, from, to]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }
}
