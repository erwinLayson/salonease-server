import type { RowDataPacket } from "mysql2/promise";

import { runMigrations } from "../migration.js";
import { runSeed } from "../seeds/seed.js";
import { databasePool } from "./database.js";

/**
 * Prepares the database before the server starts accepting requests:
 *
 *   1. applies pending migrations — safe on every boot, tracked in
 *      `schema_migrations`, so a fresh production database (which used to
 *      serve 503s for missing tables) is created automatically;
 *   2. runs the seeder only when the database has no users yet, so data or
 *      passwords changed after the first deploy are never overwritten.
 *
 * Throws when migrations fail — the server exits instead of serving an
 * unusable schema.
 */
export const bootstrapDatabase = async (): Promise<void> => {
    await runMigrations();

    const [rows] = await databasePool().query<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM users"
    );
    const userCount = Number(rows[0]?.count ?? 0);

    if (userCount > 0) {
        console.log(`Database already has ${userCount} user(s). Skipping seed.`);
        return;
    }

    if (!process.env.SEED_OWNER_PASSWORD || !process.env.SEED_STAFF_PASSWORD) {
        console.warn(
            "Empty database but SEED_OWNER_PASSWORD / SEED_STAFF_PASSWORD are not set. Skipping seed."
        );
        return;
    }

    await runSeed();
};
