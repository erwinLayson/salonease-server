import type { PoolConnection } from "mysql2/promise";
import CommissionModel from "../model/commissions.js";
import InventoryModel from "../model/inventory.js";
import ServiceModel from "../model/services.js";
import EventModel from "../model/events.js";
import StaffModel from "../model/staff.js";
import TransactionModel from "../model/transactions.js";
import DailyCloseModel from "../model/dailyClose.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { BadRequestError, ConflictError, NotFoundError } from "../helper/error.js";
import { formatDate, toDateString } from "../helper/time.js";
import {
    calculateCommission,
    resolveCommissionRule,
    roundMoney,
} from "./commissionRules.js";

// Types
import type { CommissionRateType, CommissionRule } from "./commissionRules.js";
import type {
    CommissionEntryRow,
    CommissionPayoutRow,
    CommissionRuleRow,
} from "../model/commissions.js";
import type { TransactionDetail } from "./transactions.js";
import type { EventRow } from "../model/events.js";

export interface CommissionRuleDetail {
    id: number;
    staffId: number | null;
    serviceId: number | null;
    serviceCategory: string | null;
    rateType: CommissionRateType;
    rateValue: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    priority: number;
    isActive: boolean;
    notes: string | null;
}

export interface CommissionEntryDetail {
    id: number;
    sourceType: "appointment" | "event";
    sourceId: number;
    transactionId: number | null;
    transactionReference: string | null;
    eventId: number | null;
    eventReference: string | null;
    staffId: number;
    staffName: string;
    serviceId: number | null;
    serviceName: string | null;
    baseAmount: number;
    rateType: CommissionRateType;
    rateValue: number;
    commissionAmount: number;
    status: string;
    payoutId: number | null;
    accruedAt: Date;
}

export interface PayoutDetail {
    id: number;
    staffId: number;
    staffName: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: number;
    status: string;
    paymentMethod: string | null;
    paidAt: Date | null;
    notes: string | null;
}

const toRule = (row: CommissionRuleRow): CommissionRuleDetail => ({
    id: row.id,
    staffId: row.staff_id,
    serviceId: row.service_id,
    serviceCategory: row.service_category,
    rateType: row.rate_type,
    rateValue: Number(row.rate_value),
    effectiveFrom: toDateString(row.effective_from),
    effectiveTo: row.effective_to === null ? null : toDateString(row.effective_to),
    priority: row.priority,
    isActive: row.is_active === 1,
    notes: row.notes,
});

const toRuleEngine = (row: CommissionRuleRow): CommissionRule => ({
    id: row.id,
    staffId: row.staff_id,
    serviceId: row.service_id,
    serviceCategory: row.service_category,
    rateType: row.rate_type,
    rateValue: Number(row.rate_value),
    effectiveFrom: toDateString(row.effective_from),
    effectiveTo: row.effective_to === null ? null : toDateString(row.effective_to),
    priority: row.priority,
    isActive: row.is_active === 1,
});

const toEntry = (row: CommissionEntryRow): CommissionEntryDetail => ({
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    transactionId: row.transaction_id,
    transactionReference: row.transaction_reference,
    eventId: row.event_id,
    eventReference: row.event_reference,
    staffId: row.staff_id,
    staffName: row.staff_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    baseAmount: Number(row.base_amount),
    rateType: row.rate_type,
    rateValue: Number(row.rate_value),
    commissionAmount: Number(row.commission_amount),
    status: row.status,
    payoutId: row.payout_id,
    accruedAt: row.accrued_at,
});

const toPayout = (row: CommissionPayoutRow): PayoutDetail => ({
    id: row.id,
    staffId: row.staff_id,
    staffName: row.staff_name,
    periodStart: toDateString(row.period_start),
    periodEnd: toDateString(row.period_end),
    totalAmount: Number(row.total_amount),
    status: row.status,
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
    notes: row.notes,
});

// --- Rules ---

export const listRules = (includeInactive: boolean): Promise<CommissionRuleDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new CommissionModel(connection).listRules(includeInactive);
        return rows.map(toRule);
    });

export interface RuleInput {
    staffId: number | null;
    serviceId: number | null;
    serviceCategory: string | null;
    rateType: CommissionRateType;
    rateValue: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    priority: number;
    notes: string | null;
}

const validateRuleInput = (input: RuleInput): void => {
    if (input.rateValue < 0) {
        throw new BadRequestError("rateValue must be 0 or more");
    }
    if (input.rateType === "percent" && input.rateValue > 100) {
        throw new BadRequestError("A percentage rate cannot exceed 100");
    }
    if (input.effectiveTo !== null && input.effectiveTo < input.effectiveFrom) {
        throw new BadRequestError("effectiveTo must be on or after effectiveFrom");
    }
};

export const createRule = (input: RuleInput): Promise<CommissionRuleDetail> =>
    withTransaction(async (connection) => {
        validateRuleInput(input);
        const id = await new CommissionModel(connection).createRule(input);
        return toRule((await new CommissionModel(connection).findRuleById(id))!);
    });

export const updateRule = (
    id: number,
    input: RuleInput & { isActive: boolean }
): Promise<CommissionRuleDetail> =>
    withTransaction(async (connection) => {
        validateRuleInput(input);
        const model = new CommissionModel(connection);
        if (!(await model.findRuleById(id))) {
            throw new NotFoundError("Commission rule not found", 404);
        }
        await model.updateRule(id, input);
        return toRule((await model.findRuleById(id))!);
    });

export const deleteRule = (id: number): Promise<void> =>
    withTransaction(async (connection) => {
        const model = new CommissionModel(connection);
        if (!(await model.findRuleById(id))) {
            throw new NotFoundError("Commission rule not found", 404);
        }
        await model.deleteRule(id);
    });

export interface CommissionPreview {
    baseAmount: number;
    /** Matched rule, or null when no active rule applies ("no rule"). */
    rule: CommissionRule | null;
    commissionAmount: number;
}

/**
 * Preview calculator: resolves the rule that would apply to a sale without
 * writing anything. Lets the owner verify a rule change before saving it.
 */
export const previewCommission = (input: {
    staffId: number;
    serviceId: number;
    baseAmount: number;
    date: string;
}): Promise<CommissionPreview> =>
    withConnection(async (connection) => {
        const service = await new ServiceModel(connection).findById(input.serviceId);
        if (!service) throw new NotFoundError("Service not found", 404);

        const rules = (await new CommissionModel(connection).listActiveRules()).map(toRuleEngine);
        const rule = resolveCommissionRule(rules, {
            staffId: input.staffId,
            serviceId: input.serviceId,
            serviceCategory: service.category ?? null,
            date: input.date,
        });

        return {
            baseAmount: input.baseAmount,
            rule,
            commissionAmount: calculateCommission(input.baseAmount, rule),
        };
    });

// --- Accrual ---

/**
 * Recomputes the transaction's commission and inventory-cost snapshots from
 * the ledger. Called after every accrual.
 */
export const syncTransactionTotals = async (
    connection: PoolConnection,
    transactionId: number,
    reference: { type: "appointment" | "event"; id: number }
): Promise<void> => {
    const commissionModel = new CommissionModel(connection);
    const commissionTotal = await commissionModel.sumForTransaction(transactionId);

    const inventoryCost = await new InventoryModel(connection).sumUsageCost(
        reference.type,
        reference.id
    );

    await new TransactionModel(connection).updateTotals(
        transactionId,
        commissionTotal,
        roundMoney(inventoryCost)
    );
};

export interface AccrualResult {
    entries: CommissionEntryDetail[];
    skipped: number;
}

/** Accrues commission for a completed appointment. */
export const accrueForAppointment = async (
    connection: PoolConnection,
    opts: {
        appointmentId: number;
        transaction: TransactionDetail;
        staffId: number;
        serviceId: number;
        completedAt: Date;
    }
): Promise<AccrualResult> => {
    const model = new CommissionModel(connection);
    const service = await new ServiceModel(connection).findById(opts.serviceId);
    const rules = await model.listActiveRules();
    const rule = resolveCommissionRule(rules.map(toRuleEngine), {
        staffId: opts.staffId,
        serviceId: opts.serviceId,
        serviceCategory: service?.category ?? null,
        date: formatDate(opts.completedAt),
    });

    if (!rule) {
        return { entries: [], skipped: 1 };
    }

    const existing = await model.findEntry("appointment", opts.appointmentId, opts.staffId);
    if (existing) {
        return { entries: [toEntry(existing)], skipped: 0 };
    }

    const amount = calculateCommission(opts.transaction.subtotal, rule);
    await model.insertEntry({
        sourceType: "appointment",
        sourceId: opts.appointmentId,
        transactionId: opts.transaction.id,
        eventId: null,
        staffId: opts.staffId,
        serviceId: opts.serviceId,
        baseAmount: opts.transaction.subtotal,
        rateType: rule.rateType,
        rateValue: rule.rateValue,
        commissionAmount: amount,
        accruedAt: opts.completedAt,
        notes: null,
    });

    await syncTransactionTotals(connection, opts.transaction.id, {
        type: "appointment",
        id: opts.appointmentId,
    });

    const created = await model.findEntry("appointment", opts.appointmentId, opts.staffId);
    return { entries: created ? [toEntry(created)] : [], skipped: 0 };
};

/**
 * Accrues commission for each staff member on a completed event. An explicit
 * `commission_share_percent` on the assignment overrides the rule.
 */
export const accrueForEvent = async (
    connection: PoolConnection,
    opts: {
        event: EventRow;
        transaction: TransactionDetail;
        completedAt: Date;
    }
): Promise<AccrualResult> => {
    const model = new CommissionModel(connection);
    const eventModel = new EventModel(connection);
    const rules = (await model.listActiveRules()).map(toRuleEngine);
    const services = await eventModel.listEventServices(opts.event.id);
    const primaryService = services[0] ?? null;
    const service = primaryService
        ? await new ServiceModel(connection).findById(primaryService.service_id)
        : null;
    const assignments = await eventModel.listAssignments(opts.event.id);

    const created: CommissionEntryDetail[] = [];
    let skipped = 0;

    for (const assignment of assignments) {
        if (assignment.status === "cancelled" || assignment.status === "declined") {
            skipped += 1;
            continue;
        }

        const existing = await model.findEntry("event", opts.event.id, assignment.staff_id);
        if (existing) {
            created.push(toEntry(existing));
            continue;
        }

        const share =
            assignment.commission_share_percent === null
                ? null
                : Number(assignment.commission_share_percent);

        const rule: CommissionRule | null =
            share !== null
                ? {
                      id: -1,
                      staffId: assignment.staff_id,
                      serviceId: primaryService?.service_id ?? null,
                      serviceCategory: service?.category ?? null,
                      rateType: "percent",
                      rateValue: share,
                      effectiveFrom: "1900-01-01",
                      effectiveTo: null,
                      priority: 9999,
                      isActive: true,
                  }
                : resolveCommissionRule(rules, {
                      staffId: assignment.staff_id,
                      serviceId: primaryService?.service_id ?? null,
                      serviceCategory: service?.category ?? null,
                      date: formatDate(opts.completedAt),
                  });

        if (!rule) {
            skipped += 1;
            continue;
        }

        const amount = calculateCommission(opts.transaction.subtotal, rule);
        await model.insertEntry({
            sourceType: "event",
            sourceId: opts.event.id,
            transactionId: opts.transaction.id,
            eventId: opts.event.id,
            staffId: assignment.staff_id,
            serviceId: primaryService?.service_id ?? null,
            baseAmount: opts.transaction.subtotal,
            rateType: rule.rateType,
            rateValue: rule.rateValue,
            commissionAmount: amount,
            accruedAt: opts.completedAt,
            notes: `Event role: ${assignment.role}`,
        });

        const entry = await model.findEntry("event", opts.event.id, assignment.staff_id);
        if (entry) created.push(toEntry(entry));
    }

    await syncTransactionTotals(connection, opts.transaction.id, {
        type: "event",
        id: opts.event.id,
    });

    return { entries: created, skipped };
};

// --- Entries and payouts ---

export const listEntries = (filter: {
    from?: Date | null;
    to?: Date | null;
    staffId?: number | null;
    status?: string | null;
}): Promise<CommissionEntryDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new CommissionModel(connection).listEntries(filter);
        return rows.map(toEntry);
    });

const findStaffForUser = (userId: number) =>
    withConnection((connection) => new StaffModel(connection).findByUserId(userId));

export const listStaffEntries = async (
    userId: number,
    from: Date,
    to: Date
): Promise<CommissionEntryDetail[]> => {
    const staff = await findStaffForUser(userId);
    if (!staff) return [];
    return listEntries({ from, to, staffId: staff.id, status: null });
};

export const listPayouts = async (
    staffId?: number | null
): Promise<PayoutDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new CommissionModel(connection).listPayouts();
        return rows
            .filter((row) => !staffId || row.staff_id === staffId)
            .map(toPayout);
    });

export interface CreatePayoutInput {
    staffId: number;
    periodStart: string;
    periodEnd: string;
    notes: string | null;
    createdBy: number | null;
}

export const createPayout = (input: CreatePayoutInput): Promise<PayoutDetail> =>
    withTransaction(async (connection) => {
        if (input.periodEnd < input.periodStart) {
            throw new BadRequestError("periodEnd must be on or after periodStart");
        }
        const model = new CommissionModel(connection);
        const total = await model.sumEntriesForPeriod(
            input.staffId,
            input.periodStart,
            input.periodEnd
        );
        if (total <= 0) {
            throw new ConflictError(
                "There are no unpaid commission entries for this staff member and period."
            );
        }
        const id = await model.createPayout({
            staffId: input.staffId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            totalAmount: roundMoney(total),
            notes: input.notes,
            createdBy: input.createdBy,
        });
        return toPayout((await model.findPayoutById(id))!);
    });

export const updatePayoutStatus = (
    id: number,
    status: "draft" | "approved" | "paid" | "void",
    paymentMethod: string | null
): Promise<PayoutDetail> =>
    withTransaction(async (connection) => {
        const model = new CommissionModel(connection);
        const payout = await model.findPayoutById(id);
        if (!payout) throw new NotFoundError("Payout not found", 404);
        if (payout.status === "void") {
            throw new ConflictError("A void payout cannot be changed.");
        }
        if (status === "paid" && payout.status !== "approved") {
            throw new ConflictError("Approve the payout before marking it paid.");
        }

        await model.updatePayoutStatus(id, status, paymentMethod);
        if (status === "paid") {
            await model.assignEntriesToPayout(
                payout.staff_id,
                toDateString(payout.period_start),
                toDateString(payout.period_end),
                id
            );
        }

        return toPayout((await model.findPayoutById(id))!);
    });

export const listStaffPayouts = async (userId: number): Promise<PayoutDetail[]> => {
    const staff = await findStaffForUser(userId);
    if (!staff) return [];
    return listPayouts(staff.id);
};

/** Aggregated commission totals for the owner report. */
export const commissionSummary = (from: Date, to: Date) =>
    withConnection((connection) =>
        new DailyCloseModel(connection).commissionSummary(from, to)
    );
