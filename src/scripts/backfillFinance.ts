import dotenv from "dotenv";
dotenv.config();

import DailyCloseModel from "../model/dailyClose.js";
import EventModel from "../model/events.js";
import { closeDatabasePool } from "../config/database.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import {
    createTransactionForAppointmentInConnection,
    createTransactionForEventInConnection,
} from "../service/transactions.js";
import { runIfMain } from "../helper/runIfMain.js";

/**
 * One-time financial backfill / reconciliation.
 *
 * Creates the missing billing transaction for completed appointments and
 * events. Every write is idempotent: an existing transaction is returned,
 * never duplicated.
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
    skipped: number;
}

const summarize = (summary: Summary): void => {
    console.log(
        `Appointments: ${summary.appointments} transaction(s), ` +
            `events: ${summary.events} transaction(s), ` +
            `skipped: ${summary.skipped}.`
    );
};

const run = async (): Promise<void> => {
    const apply = process.argv.includes("--apply");
    const mode = apply ? "APPLY" : "DRY RUN";
    const summary: Summary = {
        appointments: 0,
        events: 0,
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
            await createTransactionForAppointmentInConnection(connection, {
                appointmentId: Number(row.id),
                customerId: Number(row.customer_id),
                staffId: Number(row.staff_id),
                serviceId: Number(row.service_id),
                price: Number(row.price),
                completedAt: row.occurred_at,
            });
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

            await createTransactionForEventInConnection(connection, {
                eventId: event.id,
                customerId: event.customer_id,
                staffId: Number(row.staff_id),
                serviceId: Number(row.service_id),
                price: Number(row.total),
                completedAt: row.occurred_at,
            });
        });
        summary.events += 1;
    }

    summarize(summary);
    if (!apply) {
        console.log("No rows were written. Re-run with -- --apply to backfill.");
    }

    await closeDatabasePool();
};

runIfMain(import.meta.url, "Finance backfill failed:", run);
