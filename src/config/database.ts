import mysql from "mysql2/promise";

// Helper
import {getEnvName} from "../helper/getEnvName.js";

let pool: mysql.Pool | undefined;

export const databasePool = ():mysql.Pool => {
    pool ??= mysql.createPool({
        host: getEnvName(`DB_HOST`),
        user: getEnvName(`DB_USER`),
        password: getEnvName(`DB_PASSWORD`),
        database: getEnvName(`DB_NAME`),
        port: Number(getEnvName('DB_PORT')),
        // Return DECIMAL columns (e.g. services.price) as JS numbers, not strings.
        decimalNumbers: true
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