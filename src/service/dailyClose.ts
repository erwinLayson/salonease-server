import type { PoolConnection } from "mysql2/promise";
import DailyCloseModel from "../model/dailyClose.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { ConflictError, NotFoundError } from "../helper/error.js";
import { combineDateTime, endOfDay, formatDate, toDateString } from "../helper/time.js";

// Types
import type { DailyClosureRow, SalesReportRow } from "../model/dailyClose.js";

export interface DailyClosureDetail {
    id: number;
    businessDate: string;
    grossSales: number;
    discounts: number;
    netSales: number;
    paidTotal: number;
    unpaidTotal: number;
    waivedTotal: number;
    cashTotal: number;
    gcashTotal: number;
    cardTotal: number;
    otherTotal: number;
    commissionTotal: number;
    inventoryCostTotal: number;
    transactionCount: number;
    cashCounted: number | null;
    cashVariance: number | null;
    status: "open" | "closed" | "reopened";
    notes: string | null;
    closedAt: Date | null;
    reopenedAt: Date | null;
    reopenReason: string | null;
}

export interface DaySummary extends DailyClosureDetail {
    live: {
        transactionCount: number;
        grossSales: number;
        paidTotal: number;
        unpaidTotal: number;
        waivedTotal: number;
        cashTotal: number;
        gcashTotal: number;
        cardTotal: number;
        otherTotal: number;
        commissionTotal: number;
        inventoryCostTotal: number;
    };
}

const toDetail = (row: DailyClosureRow): DailyClosureDetail => ({
    id: row.id,
    businessDate: toDateString(row.business_date),
    grossSales: Number(row.gross_sales),
    discounts: Number(row.discounts),
    netSales: Number(row.net_sales),
    paidTotal: Number(row.paid_total),
    unpaidTotal: Number(row.unpaid_total),
    waivedTotal: Number(row.waived_total),
    cashTotal: Number(row.cash_total),
    gcashTotal: Number(row.gcash_total),
    cardTotal: Number(row.card_total),
    otherTotal: Number(row.other_total),
    commissionTotal: Number(row.commission_total),
    inventoryCostTotal: Number(row.inventory_cost_total),
    transactionCount: Number(row.transaction_count),
    cashCounted: row.cash_counted === null ? null : Number(row.cash_counted),
    cashVariance: row.cash_variance === null ? null : Number(row.cash_variance),
    status: row.status,
    notes: row.notes,
    closedAt: row.closed_at,
    reopenedAt: row.reopened_at,
    reopenReason: row.reopen_reason,
});

const dayRange = (date: string): { from: Date; to: Date } => {
    const from = combineDateTime(date, "00:00:00");
    return { from, to: endOfDay(from) };
};

/** Today's live totals plus the stored close, if one exists. */
export const getDaySummary = (date: string): Promise<DaySummary> =>
    withConnection(async (connection) => {
        const model = new DailyCloseModel(connection);
        const { from, to } = dayRange(date);
        const summary = await model.salesSummary(from, to);
        const closure = await model.findByDate(date);

        const live = {
            transactionCount: Number(summary.transaction_count),
            grossSales: Number(summary.gross_sales),
            paidTotal: Number(summary.paid_total),
            unpaidTotal: Number(summary.unpaid_total),
            waivedTotal: Number(summary.waived_total),
            cashTotal: Number(summary.cash_total),
            gcashTotal: Number(summary.gcash_total),
            cardTotal: Number(summary.card_total),
            otherTotal: Number(summary.other_total),
            commissionTotal: Number(summary.commission_total),
            inventoryCostTotal: Number(summary.inventory_cost_total),
        };

        if (!closure) {
            return {
                id: 0,
                businessDate: date,
                grossSales: live.grossSales,
                discounts: 0,
                netSales: live.grossSales,
                paidTotal: live.paidTotal,
                unpaidTotal: live.unpaidTotal,
                waivedTotal: live.waivedTotal,
                cashTotal: live.cashTotal,
                gcashTotal: live.gcashTotal,
                cardTotal: live.cardTotal,
                otherTotal: live.otherTotal,
                commissionTotal: live.commissionTotal,
                inventoryCostTotal: live.inventoryCostTotal,
                transactionCount: live.transactionCount,
                cashCounted: null,
                cashVariance: null,
                status: "open",
                notes: null,
                closedAt: null,
                reopenedAt: null,
                reopenReason: null,
                live,
            };
        }

        return { ...toDetail(closure), live };
    });

export interface CloseDayInput {
    date: string;
    cashCounted: number | null;
    notes: string | null;
    userId: number | null;
}

export const closeDay = (input: CloseDayInput): Promise<DailyClosureDetail> =>
    withTransaction(async (connection) => {
        const model = new DailyCloseModel(connection);
        const existing = await model.findByDate(input.date);
        if (existing && existing.status === "closed") {
            throw new ConflictError(
                `The business date ${input.date} is already closed. Reopen it to make changes.`
            );
        }

        const { from, to } = dayRange(input.date);
        const summary = await model.salesSummary(from, to);
        const cashVariance =
            input.cashCounted === null
                ? null
                : Number(input.cashCounted) - Number(summary.cash_total);

        await model.upsertClosure({
            businessDate: input.date,
            grossSales: Number(summary.gross_sales),
            netSales: Number(summary.gross_sales),
            paidTotal: Number(summary.paid_total),
            unpaidTotal: Number(summary.unpaid_total),
            waivedTotal: Number(summary.waived_total),
            cashTotal: Number(summary.cash_total),
            gcashTotal: Number(summary.gcash_total),
            cardTotal: Number(summary.card_total),
            otherTotal: Number(summary.other_total),
            commissionTotal: Number(summary.commission_total),
            inventoryCostTotal: Number(summary.inventory_cost_total),
            transactionCount: Number(summary.transaction_count),
            cashCounted: input.cashCounted,
            cashVariance,
            notes: input.notes,
            closedBy: input.userId,
        });

        return toDetail((await model.findByDate(input.date))!);
    });

export const reopenDay = (
    date: string,
    reason: string,
    userId: number
): Promise<DailyClosureDetail> =>
    withTransaction(async (connection) => {
        const model = new DailyCloseModel(connection);
        const existing = await model.findByDate(date);
        if (!existing) {
            throw new NotFoundError("Daily closure not found", 404);
        }
        if (existing.status !== "closed") {
            throw new ConflictError("Only a closed business date can be reopened.");
        }
        await model.reopen(date, userId, reason);
        return toDetail((await model.findByDate(date))!);
    });

export const listClosures = (from: string, to: string): Promise<DailyClosureDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new DailyCloseModel(connection).listClosures(from, to);
        return rows.map(toDetail);
    });

/** Rejects edits to a day that has already been closed. */
export const assertDayOpen = async (
    connection: PoolConnection,
    date: Date
): Promise<void> => {
    const model = new DailyCloseModel(connection);
    const closure = await model.findByDate(formatDate(date));
    if (closure && closure.status === "closed") {
        throw new ConflictError(
            `${formatDate(date)} is closed. Reopen the business date before editing its transactions.`
        );
    }
};

export const getSalesReport = (
    from: Date,
    to: Date,
    groupBy: "day" | "week" | "month" | "staff" | "service" | "method"
): Promise<SalesReportRow[]> =>
    withConnection(async (connection) => {
        const rows = await new DailyCloseModel(connection).salesReport(from, to, groupBy);
        return rows.map((row) => ({
            ...row,
            // DATE buckets arrive as local Date objects; month buckets are
            // already formatted strings by DATE_FORMAT.
            bucket:
                groupBy === "day" || groupBy === "week"
                    ? toDateString(row.bucket)
                    : String(row.bucket),
            transactions: Number(row.transactions),
            gross: Number(row.gross),
            paid: Number(row.paid),
            commission: Number(row.commission),
        }));
    });

export interface ReconciliationReport {
    from: string;
    to: string;
    missingTransactions: Array<{
        kind: "appointment" | "event";
        id: number;
        reference: string;
        occurredAt: Date;
        customerName: string;
        staffName: string;
        serviceName: string | null;
        amount: number;
    }>;
    missingCommissions: Array<{
        id: number;
        reference: string;
        completedAt: Date;
        staffName: string;
        subtotal: number;
        appointmentId: number | null;
        eventId: number | null;
    }>;
    commissionMismatches: Array<{
        id: number;
        reference: string;
        completedAt: Date;
        storedTotal: number;
        ledgerTotal: number;
    }>;
    counts: {
        missingTransactions: number;
        missingCommissions: number;
        commissionMismatches: number;
    };
}

/**
 * Lists records that fall outside the financial ledger so the owner can run the
 * backfill script and see exactly what it will change.
 */
export const getReconciliation = async (
    from: Date,
    to: Date
): Promise<ReconciliationReport> => {
    return withConnection(async (connection) => {
        const model = new DailyCloseModel(connection);
        const [appointments, events, missingCommissions, mismatches] = await Promise.all([
            model.missingAppointmentTransactions(from, to),
            model.missingEventTransactions(from, to),
            model.missingCommissions(from, to),
            model.commissionMismatches(from, to),
        ]);

        const missingTransactions = [...appointments, ...events].map((row) => ({
            kind: row.kind,
            id: Number(row.id),
            reference: row.reference,
            occurredAt: row.occurred_at,
            customerName: row.customer_name,
            staffName: row.staff_name,
            serviceName: row.service_name,
            amount: Number(row.amount),
        }));

        return {
            from: formatDate(from),
            to: formatDate(new Date(to.getTime() - 1)),
            missingTransactions,
            missingCommissions: missingCommissions.map((row) => ({
                id: Number(row.id),
                reference: row.reference,
                completedAt: row.completed_at,
                staffName: row.staff_name,
                subtotal: Number(row.subtotal),
                appointmentId: row.appointment_id === null ? null : Number(row.appointment_id),
                eventId: row.event_id === null ? null : Number(row.event_id),
            })),
            commissionMismatches: mismatches.map((row) => ({
                id: Number(row.id),
                reference: row.reference,
                completedAt: row.completed_at,
                storedTotal: Number(row.stored_total),
                ledgerTotal: Number(row.ledger_total),
            })),
            counts: {
                missingTransactions: missingTransactions.length,
                missingCommissions: missingCommissions.length,
                commissionMismatches: mismatches.length,
            },
        };
    });
};

export const getCommissionReport = (from: Date, to: Date) =>
    withConnection((connection) =>
        new DailyCloseModel(connection).commissionSummary(from, to)
    );
