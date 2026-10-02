import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createConnection, type Connection, type RowDataPacket } from "mysql2/promise";
import { runIfMain } from "./helper/runIfMain.js";

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
        // No `multipleStatements`: files are split and executed one statement
        // at a time (see splitStatements), which also works on servers that
        // reject multi-statement queries (e.g. TiDB with
        // tidb_multi_statement_mode=OFF).
    });

/**
 * Splits a migration file into individual statements on top-level `;`.
 *
 * Line comments (`--`, `#`) and quoted strings / backtick identifiers are
 * tracked so a `;` or `--` inside them never splits a statement. Block
 * comments are left untouched (no current migration uses them).
 */
const splitStatements = (sql: string): string[] => {
    const statements: string[] = [];
    let current = "";
    let quote: "'" | '"' | "`" | null = null;
    let inLineComment = false;

    for (let i = 0; i < sql.length; i++) {
        const char = sql[i]!;
        const next = sql[i + 1];

        if (inLineComment) {
            if (char === "\n") {
                inLineComment = false;
                current += char;
            }
            continue;
        }

        if (quote !== null) {
            current += char;
            // Backslash escapes and doubled quotes both stay inside the literal.
            if (char === "\\" && next !== undefined) {
                current += next;
                i++;
            } else if (char === quote) {
                quote = null;
            }
            continue;
        }

        if ((char === "-" && next === "-") || char === "#") {
            if (char === "-") i++;
            inLineComment = true;
            continue;
        }
        if (char === "'" || char === '"' || char === "`") {
            quote = char;
            current += char;
            continue;
        }
        if (char === ";") {
            statements.push(current);
            current = "";
            continue;
        }
        current += char;
    }

    if (current.trim().length > 0) statements.push(current);
    return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
};

/** True for `ALTER TABLE ... DROP {CONSTRAINT|CHECK} ...` statements. */
const isDropConstraint = (statement: string): boolean =>
    /^\s*ALTER\s+TABLE\b[\s\S]*\bDROP\s+(?:CONSTRAINT|CHECK)\b/i.test(statement);

/**
 * MySQL/TiDB report a missing constraint differently, but every variant
 * means the same thing: there is nothing to drop, so it is safe to continue.
 */
const isMissingConstraintError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return /can'?t drop|check that it exists|doesn'?t exist|does not exist|not found/i.test(message);
};

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

/** Applies every `.sql` file that is not yet recorded in `schema_migrations`. */
export const runMigrations = async (): Promise<void> => {
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
                for (const statement of splitStatements(sql)) {
                    try {
                        await connection.query(statement);
                    } catch (error) {
                        // TiDB does not record CHECK constraints while
                        // tidb_enable_check_constraint is OFF (the default), so
                        // dropping one is a no-op there — while MySQL 8 needs
                        // the statement. Tolerating "nothing to drop" keeps the
                        // same file valid on both engines.
                        if (isDropConstraint(statement) && isMissingConstraintError(error)) {
                            console.warn(`Skipped (constraint not present): ${statement.replace(/\s+/g, " ")}`);
                            continue;
                        }
                        throw error;
                    }
                }
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

runIfMain(import.meta.url, "Migration failed:", runMigrations);
