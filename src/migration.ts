import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/** Tracks which migration files have already been applied. */
const MIGRATIONS_TABLE = "schema_migrations";

const required = (name: string): string => {
    const value = process.env[name];
    if (value === undefined) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
};

const openConnection = (): Promise<Connection> =>
    createConnection({
        host: required("DB_HOST"),
        user: required("DB_USER"),
        password: required("DB_PASSWORD"),
        database: required("DB_NAME"),
        port: Number(required("DB_PORT")),
        // Migrations contain several statements per file.
        multipleStatements: true,
    });

const ensureMigrationsTable = async (connection: Connection): Promise<void> => {
    await connection.query(`
        CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            filename   VARCHAR(255)    NOT NULL,
            applied_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_schema_migrations_filename (filename)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
};

const getAppliedMigrations = async (connection: Connection): Promise<Set<string>> => {
    const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT filename FROM ${MIGRATIONS_TABLE}`
    );
    return new Set(rows.map((row) => row.filename as string));
};

const run = async (): Promise<void> => {
    const connection = await openConnection();

    try {
        await ensureMigrationsTable(connection);
        const applied = await getAppliedMigrations(connection);

        const files = (await fs.readdir(MIGRATIONS_DIR))
            .filter((file) => file.endsWith(".sql"))
            .sort();

        const pending = files.filter((file) => !applied.has(file));

        if (pending.length === 0) {
            console.log("No pending migrations. Database is up to date.");
            return;
        }

        for (const file of pending) {
            const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
            try {
                // NOTE: MySQL DDL causes an implicit commit, so a failure mid-file
                // cannot be fully rolled back. Keep each migration a single logical
                // change so re-running after a fix is safe.
                await connection.query(sql);
                await connection.execute(
                    `INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES (?)`,
                    [file]
                );
                console.log(`Applied ${file}`);
            } catch (error) {
                console.error(`Failed to apply ${file}:`, (error as Error).message);
                throw error;
            }
        }

        console.log(`Done. ${pending.length} migration(s) applied.`);
    } finally {
        await connection.end();
    }
};

run().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
});
