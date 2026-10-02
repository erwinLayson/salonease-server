import type { PoolConnection } from "mysql2/promise";
import { databasePool } from "../config/database.js";
import { isDeadlockError } from "./error.js";

/** Runs a callback with a pooled connection, always releasing it afterwards. */
export const withConnection = async <T>(
    fn: (connection: PoolConnection) => Promise<T>
): Promise<T> => {
    const connection = await databasePool().getConnection();

    try {
        return await fn(connection);
    } finally {
        connection.release();
    }
};

/**
 * Runs a callback inside a transaction, committing on success and rolling back
 * on any error. Used for multi-step writes (e.g. creating a user + staff row).
 *
 * MySQL deadlocks (`ER_LOCK_DEADLOCK`) are transient: the transaction is
 * retried on a fresh connection up to `retries` times before the error escapes.
 */
export const withTransaction = async <T>(
    fn: (connection: PoolConnection) => Promise<T>,
    options: { retries?: number } = {}
): Promise<T> => {
    const maxRetries = options.retries ?? 3;

    for (let attempt = 0; ; attempt += 1) {
        const connection = await databasePool().getConnection();

        try {
            await connection.beginTransaction();
            const result = await fn(connection);
            await connection.commit();
            return result;
        } catch (err) {
            await connection.rollback();

            if (attempt < maxRetries && isDeadlockError(err)) {
                continue; // retry with a fresh connection
            }

            throw err;
        } finally {
            connection.release();
        }
    }
};
