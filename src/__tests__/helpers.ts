import { randomBytes } from "node:crypto";
import type { ResultSetHeader } from "mysql2/promise";
import { databasePool } from "../config/database.js";
import { hashPassword } from "../helper/password.js";

// Types
import type { Role } from "../constant/users.js";

/** Shared password for all throwaway test accounts. */
export const TEST_PASSWORD = "TestPass#2026";

export interface TestUser {
    id: number;
    username: string;
    password: string;
    role: Role;
}

const uniqueUsername = (role: Role): string =>
    `test_${role}_${randomBytes(4).toString("hex")}`;

const insertUser = async (role: Role, isActive: number): Promise<TestUser> => {
    const username = uniqueUsername(role);
    const connection = await databasePool().getConnection();

    try {
        const [result] = await connection.execute<ResultSetHeader>(
            "INSERT INTO users (username, email, password, role, is_active) VALUES (?, ?, ?, ?, ?)",
            [username, null, hashPassword(TEST_PASSWORD), role, isActive]
        );
        return { id: result.insertId, username, password: TEST_PASSWORD, role };
    } finally {
        connection.release();
    }
};

/** Creates an active throwaway user for a given role. */
export const createTestUser = (role: Role): Promise<TestUser> => insertUser(role, 1);

/** Creates a deactivated throwaway user (login must be rejected). */
export const createInactiveTestUser = (role: Role): Promise<TestUser> => insertUser(role, 0);

/** Removes a throwaway user. */
export const deleteTestUser = async (id: number): Promise<void> => {
    const connection = await databasePool().getConnection();
    try {
        await connection.execute("DELETE FROM users WHERE id = ?", [id]);
    } finally {
        connection.release();
    }
};

/** Safety net: removes any leftover test accounts. */
export const cleanupTestUsers = async (): Promise<void> => {
    const connection = await databasePool().getConnection();
    try {
        await connection.execute("DELETE FROM users WHERE username LIKE 'test\\_%'");
    } finally {
        connection.release();
    }
};

/** Creates a throwaway customer + appointment directly in the database. */
export const insertTestAppointment = async (opts: {
    staffId: number;
    serviceId: number;
    startOffsetDays: number;
    status?: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
    durationMinutes?: number;
}): Promise<number> => {
    const connection = await databasePool().getConnection();
    const duration = opts.durationMinutes ?? 60;

    try {
        const [customer] = await connection.execute<ResultSetHeader>(
            "INSERT INTO customers (first_name, phone) VALUES ('Test Customer', '09000000000')"
        );

        const reference = `TST${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 12);
        const manageToken = randomBytes(32).toString("hex");

        const [appointment] = await connection.execute<ResultSetHeader>(
            `INSERT INTO appointments
                (reference, manage_token, customer_id, staff_id, service_id,
                 start_at, end_at, buffer_end_at, status, source)
             VALUES (?, ?, ?, ?, ?,
                 DATE_ADD(NOW(), INTERVAL ? DAY),
                 DATE_ADD(DATE_ADD(NOW(), INTERVAL ? DAY), INTERVAL ? MINUTE),
                 DATE_ADD(DATE_ADD(NOW(), INTERVAL ? DAY), INTERVAL ? MINUTE),
                 ?, 'manual')`,
            [
                reference,
                manageToken,
                customer.insertId,
                opts.staffId,
                opts.serviceId,
                opts.startOffsetDays,
                opts.startOffsetDays,
                duration,
                opts.startOffsetDays,
                duration + 10,
                opts.status ?? "pending",
            ]
        );

        return appointment.insertId;
    } finally {
        connection.release();
    }
};

/** Creates a throwaway appointment at an exact start time. */
export const insertTestAppointmentAt = async (opts: {
    staffId: number;
    serviceId: number;
    startAt: Date;
    durationMinutes?: number;
    status?: "pending" | "confirmed" | "cancelled";
}): Promise<number> => {
    const connection = await databasePool().getConnection();
    const duration = opts.durationMinutes ?? 30;

    try {
        const [customer] = await connection.execute<ResultSetHeader>(
            "INSERT INTO customers (first_name, phone) VALUES ('Test Customer', '09000000000')"
        );

        const reference = `TST${randomBytes(4).toString("hex").toUpperCase()}`.slice(0, 12);

        const [appointment] = await connection.execute<ResultSetHeader>(
            `INSERT INTO appointments
                (reference, manage_token, customer_id, staff_id, service_id,
                 start_at, end_at, buffer_end_at, status, source)
             VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL ? MINUTE),
                 DATE_ADD(?, INTERVAL ? MINUTE), ?, 'manual')`,
            [
                reference,
                randomBytes(32).toString("hex"),
                customer.insertId,
                opts.staffId,
                opts.serviceId,
                opts.startAt,
                opts.startAt,
                duration,
                opts.startAt,
                duration + 10,
                opts.status ?? "pending",
            ]
        );

        return appointment.insertId;
    } finally {
        connection.release();
    }
};

/**
 * Removes appointments (and the customers they created) that belong to the given
 * staff/services. Needed because bookings made through `createBooking` use real
 * `APT-*` references rather than the `TST*` test prefix.
 */
export const cleanupBookingsFor = async (
    staffIds: number[],
    serviceIds: number[]
): Promise<void> => {
    if (staffIds.length === 0 && serviceIds.length === 0) {
        return;
    }

    const connection = await databasePool().getConnection();

    try {
        const clauses: string[] = [];
        const aliasedClauses: string[] = [];
        const params: Array<string | number | Date | null> = [];

        if (staffIds.length > 0) {
            const clause = `staff_id IN (${staffIds.map(() => "?").join(", ")})`;
            clauses.push(clause);
            aliasedClauses.push(`a.${clause}`);
            params.push(...staffIds);
        }
        if (serviceIds.length > 0) {
            const clause = `service_id IN (${serviceIds.map(() => "?").join(", ")})`;
            clauses.push(clause);
            aliasedClauses.push(`a.${clause}`);
            params.push(...serviceIds);
        }

        // Completed appointments may have transactions that would
        // block the delete (FK RESTRICT), so clear those first.
        await connection.execute(
            `DELETE FROM transactions
             WHERE appointment_id IN
                 (SELECT a.id FROM appointments a WHERE ${aliasedClauses.join(" OR ")})`,
            params
        );

        await connection.execute(
            `DELETE FROM appointments WHERE ${clauses.join(" OR ")}`,
            params
        );

        // Drop test customers that no appointment references any more.
        await connection.execute(
            `DELETE FROM customers
             WHERE (phone LIKE '0917%' OR email LIKE '%@example.local')
               AND id NOT IN (SELECT customer_id FROM appointments)`
        );
    } finally {
        connection.release();
    }
};

/** Removes appointments/customers created by `insertTestAppointment`. */
export const cleanupTestAppointments = async (): Promise<void> => {
    const connection = await databasePool().getConnection();
    try {
        await connection.execute(
            `DELETE t FROM transactions t
             JOIN appointments a ON a.id = t.appointment_id
             WHERE a.reference LIKE 'TST%'`
        );
        await connection.execute("DELETE FROM appointments WHERE reference LIKE 'TST%'");
        await connection.execute(
            "DELETE FROM customers WHERE first_name = 'Test Customer' AND phone = '09000000000'"
        );
    } finally {
        connection.release();
    }
};
