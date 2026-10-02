import mysql from "mysql2/promise";

import { databaseCredentials } from "./connection.js";

let pool: mysql.Pool | undefined;

export const databasePool = ():mysql.Pool => {
    pool ??= mysql.createPool({
        // Shared with the migration runner and the seed script so TLS behaves
        // the same everywhere (TiDB Cloud requires it on every connection).
        ...databaseCredentials(),
        // Return DECIMAL columns (e.g. services.price) as JS numbers, not strings.
        decimalNumbers: true,
    })

    return pool;
}

/** Closes the pool. Used by tests so the process can exit cleanly. */
export const closeDatabasePool = async (): Promise<void> => {
    if (pool) {
        await pool.end();
        pool = undefined;
    }
};

export const checkDBConnection = async () => {
    const pool = databasePool();
    const connection = await pool.getConnection();

    try {
        await connection.ping();
        console.log(`Database connection successfull`)
    } finally {
        connection.release();
    }
}