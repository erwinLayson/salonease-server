import dotenv from "dotenv";
dotenv.config();

import DailyCloseModel from "../model/dailyClose.js";
import AppointmentModel from "../model/appointments.js";
import EventModel from "../model/events.js";
import { closeDatabasePool } from "../config/database.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import {
    createTransactionForAppointmentInConnection,
    createTransactionForEventInConnection,
    findTransactionInConnection,
} from "../service/transactions.js";
import { accrueForAppointment, accrueForEvent } from "../service/commissions.js";
import { runIfMain } from "../helper/runIfMain.js";

/**
 * One-time financial backfill / reconciliation.
 *
 * Creates the missing billing transaction for completed appointments and
 * events, then accrues commission for transactions that have no entry. Every
 * write is idempotent: an existing transaction or entry is returned, never
 * duplicated, and an existing commission snapshot is never overwritten.
 *
 * Stock is deliberately NOT deducted here: a historical completion must not
 * change today's stock-on-hand. Run the inventory backfill only if the owner
 * accepts that adjustment.
 *
 * Usage:
 *   pnpm run backfill:finance            # dry run, reports what is missing
 *   pnpm run backfill:finance -- --apply # writes the missing records
 */

interface Summary {
    appointments: number;
    events: number;
    commissions: number;
    noRule: number;
    skipped: number;
}

const summarize = (summary: Summary): void => {
    console.log(
        `Appointments: ${summary.appointments} transaction(s), ` +
            `events: ${summary.events} transaction(s), ` +
            `commissions: ${summary.commissions} entr(ies), ` +
            `no matching rule: ${summary.noRule}, ` +
            `skipped: ${summary.skipped}.`
    );
};

const run = async (): Promise<void> => {
    const apply = process.argv.includes("--apply");
    const mode = apply ? "APPLY" : "DRY RUN";
    const summary: Summary = {
        appointments: 0,
        events: 0,
        commissions: 0,
        noRule: 0,
        skipped: 0,
    };

    console.log(`Finance backfill (${mode}).`);

    // 1. Completed appointments without a transaction.
    const appointments = await withConnection((connection) =>
        new DailyCloseModel(connection).backfillAppointments()
    );
    for (const row of appointments) {
        if (!apply) {
            summary.appointments += 1;
            continue;
        }
        await withTransaction(async (connection) => {
            const transaction = await createTransactionForAppointmentInConnection(
                connection,
                {
                    appointmentId: Number(row.id),
                    customerId: Number(row.customer_id),
                    staffId: Number(row.staff_id),
                    serviceId: Number(row.service_id),
                    price: Number(row.price),
                    completedAt: row.occurred_at,
                }
            );

            const accrued = await accrueForAppointment(connection, {
                appointmentId: Number(row.id),
                transaction,
                staffId: Number(row.staff_id),
                serviceId: Number(row.service_id),
                completedAt: transaction.completedAt,
            });
            if (accrued.skipped > 0) summary.noRule += 1;
        });
        summary.appointments += 1;
    }

    // 2. Completed events without a transaction.
    const events = await withConnection((connection) =>
        new DailyCloseModel(connection).backfillEvents()
    );
    for (const row of events) {
        if (row.staff_id === null || row.service_id === null) {
            console.warn(
                `Skipped event ${row.id}: it needs a lead stylist and at least one service.`
            );
            summary.skipped += 1;
            continue;
        }
        if (!apply) {
            summary.events += 1;
            continue;
        }
        await withTransaction(async (connection) => {
            const event = await new EventModel(connection).findEventById(Number(row.id));
            if (!event) return;

            const transaction = await createTransactionForEventInConnection(connection, {
                eventId: event.id,
                customerId: event.customer_id,
                staffId: Number(row.staff_id),
                serviceId: Number(row.service_id),
                price: Number(row.total),
                completedAt: row.occurred_at,
            });

            const accrued = await accrueForEvent(connection, {
                event,
                transaction,
                completedAt: transaction.completedAt,
            });
            if (accrued.skipped > 0) summary.noRule += 1;
        });
        summary.events += 1;
    }

    // 3. Transactions with no commission entry (e.g. rules added later).
    const transactions = await withConnection((connection) =>
        new DailyCloseModel(connection).backfillTransactionsWithoutCommission()
    );
    for (const row of transactions) {
        if (!apply) {
            summary.commissions += 1;
            continue;
        }
        try {
            await withTransaction(async (connection) => {
                const transaction = await findTransactionInConnection(
                    connection,
                    Number(row.id)
                );
                if (!transaction) return;

                if (row.appointment_id !== null) {
                    const appointment = await new AppointmentModel(connection).findById(
                        Number(row.appointment_id)
                    );
                    if (!appointment) return;
                    const accrued = await accrueForAppointment(connection, {
                        appointmentId: appointment.id,
                        transaction,
                        staffId: appointment.staff_id,
                        serviceId: appointment.service_id,
                        completedAt: transaction.completedAt,
                    });
                    if (accrued.skipped > 0) summary.noRule += 1;
                } else if (row.event_id !== null) {
                    const event = await new EventModel(connection).findEventById(
                        Number(row.event_id)
                    );
                    if (!event) return;
                    const accrued = await accrueForEvent(connection, {
                        event,
                        transaction,
                        completedAt: transaction.completedAt,
                    });
                    if (accrued.skipped > 0) summary.noRule += 1;
                }
            });
            summary.commissions += 1;
        } catch (error) {
            console.warn(
                `Skipped transaction ${row.id}: ${(error as Error).message}`
            );
            summary.skipped += 1;
        }
    }

    summarize(summary);
    if (!apply) {
        console.log("No rows were written. Re-run with -- --apply to backfill.");
    }

    await closeDatabasePool();
};

runIfMain(import.meta.url, "Finance backfill failed:", run);
