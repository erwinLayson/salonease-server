import TransactionModel from "../model/transactions.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { BadRequestError, NotFoundError } from "../helper/error.js";
import { PAYMENT_METHODS, PAYMENT_STATUSES } from "../constant/transactions.js";

import type {
    PaymentMethod,
    PaymentStatus,
    TransactionDetailRow,
    TransactionFilter,
    UpdateTransactionInput,
    YearlyReportRow,
} from "../model/transactions.js";

/** Public transaction shape (camelCase, no internal ids). */
export interface TransactionDetail {
    id: number;
    reference: string;
    appointmentId: number;
    appointmentReference: string;
    customer: {
        id: number;
        name: string;
        phone: string | null;
        email: string | null;
    };
    staff: { id: number; name: string };
    service: { id: number; name: string };
    subtotal: number;
    total: number;
    paymentMethod: PaymentMethod;
    paymentStatus: PaymentStatus;
    notes: string | null;
    completedAt: Date;
    createdAt: Date;
    updatedAt: Date | null;
}

const fullName = (first: string, last: string | null): string =>
    [first, last].filter(Boolean).join(" ").trim();

const toDetail = (row: TransactionDetailRow): TransactionDetail => ({
    id: row.id,
    reference: row.reference,
    appointmentId: row.appointment_id,
    appointmentReference: row.appointment_reference,
    customer: {
        id: row.customer_id,
        name: fullName(row.customer_first_name, row.customer_last_name),
        phone: row.customer_phone,
        email: row.customer_email,
    },
    staff: {
        id: row.staff_id,
        name: fullName(row.staff_first_name, row.staff_last_name),
    },
    service: { id: row.service_id, name: row.service_name },
    subtotal: row.subtotal,
    total: row.total,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    notes: row.notes,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

/**
 * Generates a unique transaction reference: `TXN-YYYYMMDD-<id padded to 4>`.
 * Called inside a transaction right after insert so `id` is already committed.
 */
export const buildReference = (id: number, completedAt: Date): string => {
    const d = completedAt;
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `TXN-${date}-${String(id).padStart(4, "0")}`;
};

/**
 * Creates a transaction record when an appointment is marked completed.
 * Called internally by `changeStatus` — not exposed as a public route.
 *
 * Default payment: cash / unpaid so the owner can fill it in afterwards.
 */
export const createTransactionForAppointment = async (opts: {
    appointmentId: number;
    customerId: number;
    staffId: number;
    serviceId: number;
    price: number;
    completedAt: Date;
}): Promise<TransactionDetail> =>
    withTransaction(async (connection) => {
        const model = new TransactionModel(connection);

        // Placeholder reference replaced once we have the auto-increment id.
        const insertId = await model.insert({
            reference: "TXN-PENDING",
            appointmentId: opts.appointmentId,
            customerId: opts.customerId,
            staffId: opts.staffId,
            serviceId: opts.serviceId,
            subtotal: opts.price,
            total: opts.price,
            paymentMethod: "cash",
            paymentStatus: "unpaid",
            completedAt: opts.completedAt,
        });

        const reference = buildReference(insertId, opts.completedAt);
        await connection.execute("UPDATE transactions SET reference = ? WHERE id = ?", [
            reference,
            insertId,
        ]);

        const row = await model.findById(insertId);
        return toDetail(row!);
    });

/** Owner transaction list with optional filters. */
export const listTransactions = (filter: TransactionFilter): Promise<TransactionDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new TransactionModel(connection).list(filter);
        return rows.map(toDetail);
    });

/** Single transaction by id. */
export const getTransaction = (id: number): Promise<TransactionDetail> =>
    withConnection(async (connection) => {
        const row = await new TransactionModel(connection).findById(id);
        if (!row) throw new NotFoundError("Transaction not found", 404);
        return toDetail(row);
    });

/** Transaction for an appointment (used by the appointment detail view). */
export const getTransactionByAppointment = (
    appointmentId: number
): Promise<TransactionDetail | null> =>
    withConnection(async (connection) => {
        const row = await new TransactionModel(connection).findByAppointmentId(appointmentId);
        return row ? toDetail(row) : null;
    });

export interface UpdateTransactionOptions {
    paymentMethod?: string | undefined;
    paymentStatus?: string | undefined;
    notes?: string | null | undefined;
}

/** Updates payment details (method, status, notes). */
export const updateTransaction = (
    id: number,
    input: UpdateTransactionOptions
): Promise<TransactionDetail> =>
    withTransaction(async (connection) => {
        const model = new TransactionModel(connection);
        const existing = await model.findById(id);
        if (!existing) throw new NotFoundError("Transaction not found", 404);

        const patch: UpdateTransactionInput = {};

        if (input.paymentMethod !== undefined) {
            if (!PAYMENT_METHODS.includes(input.paymentMethod as PaymentMethod)) {
                throw new BadRequestError(
                    `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`
                );
            }
            patch.paymentMethod = input.paymentMethod as PaymentMethod;
        }

        if (input.paymentStatus !== undefined) {
            if (!PAYMENT_STATUSES.includes(input.paymentStatus as PaymentStatus)) {
                throw new BadRequestError(
                    `paymentStatus must be one of: ${PAYMENT_STATUSES.join(", ")}`
                );
            }
            patch.paymentStatus = input.paymentStatus as PaymentStatus;
        }

        if (input.notes !== undefined) {
            patch.notes = input.notes;
        }

        await model.update(id, patch);
        return toDetail((await model.findById(id))!);
});

/** Payment fields a staff member may update on an appointment's transaction. */
export interface StaffTransactionInput {
    paymentMethod?: string | undefined;
    paymentStatus?: string | undefined;
}

/**
 * Records how a customer paid for a completed appointment.
 *
 * Staff may only set the payment method and paid/unpaid —
 * notes and waivers stay with the owner on the
 * Transactions page. The caller must have verified the
 * appointment belongs to the staff member.
 */
export const updateTransactionForAppointment = (
    appointmentId: number,
    input: StaffTransactionInput
): Promise<TransactionDetail> =>
    withTransaction(async (connection) => {
        const model = new TransactionModel(connection);
        const existing = await model.findByAppointmentId(appointmentId);
        if (!existing) throw new NotFoundError("Transaction not found", 404);

        const patch: UpdateTransactionInput = {};

        if (input.paymentMethod !== undefined) {
            if (!PAYMENT_METHODS.includes(input.paymentMethod as PaymentMethod)) {
                throw new BadRequestError(
                    `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`
                );
            }
            patch.paymentMethod = input.paymentMethod as PaymentMethod;
        }

        if (input.paymentStatus !== undefined) {
            // Waiving a payment is an owner decision.
            if (input.paymentStatus === "waived") {
                throw new BadRequestError("Staff cannot waive a payment.");
            }
            if (!PAYMENT_STATUSES.includes(input.paymentStatus as PaymentStatus)) {
                throw new BadRequestError(
                    `paymentStatus must be one of: ${PAYMENT_STATUSES.join(", ")}`
                );
            }
            patch.paymentStatus = input.paymentStatus as PaymentStatus;
        }

        await model.update(existing.id, patch);
        return toDetail((await model.findById(existing.id))!);
    });

/** Today's revenue summary for the dashboard. */
export const getTodaySummary = (
    from: Date,
    to: Date
): Promise<{ count: number; total: number }> =>
    withConnection((connection) => new TransactionModel(connection).summary(from, to));

/** Yearly performance report (monthly revenue, top services). */
export const getYearlyReport = (
    year: number
): Promise<YearlyReportRow> =>
    withConnection(
        (connection) => new TransactionModel(connection).yearlyReport(year)
    );
