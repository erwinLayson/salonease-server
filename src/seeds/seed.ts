import dotenv from "dotenv";
dotenv.config();

import {
    createConnection,
    type Connection,
    type ResultSetHeader,
    type RowDataPacket,
} from "mysql2/promise";
import bcrypt from "bcryptjs";
import { runIfMain } from "../helper/runIfMain.js";

/**
 * Seed script — safe to run repeatedly (idempotent).
 *
 * It creates:
 *   - 1 owner login account
 *   - sample staff (each with a login account, weekly hours, and service assignments)
 *   - a starter service catalog
 *
 * Credentials come from the environment; no passwords are hardcoded.
 * Run with:  pnpm seed
 * Also runs automatically on server startup, but only when the database has
 * no users yet (see config/bootstrap.ts) — so production data is untouched.
 */

const BCRYPT_ROUNDS = 10;

const required = (name: string): string => {
    const value = process.env[name];
    if (value === undefined) {
        throw new Error(
            `Missing required environment variable: ${name} (see server/.env.example)`
        );
    }
    return value;
};

interface SeedService {
    name: string;
    description: string;
    price: number;
    durationMinutes: number;
}

/** A weekly working block: weekday 0 = Sunday .. 6 = Saturday. */
interface SeedSchedule {
    weekday: number;
    startTime: string;
    endTime: string;
}

interface SeedStaff {
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    position: string;
    phone: string;
    schedules: SeedSchedule[];
    services: string[]; // service names
}

const SERVICES: SeedService[] = [
    { name: "Haircut", description: "Cut and style", price: 250, durationMinutes: 45 },
    { name: "Hair Styling", description: "Blow-dry and styling", price: 400, durationMinutes: 60 },
    { name: "Make-up", description: "Everyday make-up application", price: 600, durationMinutes: 60 },
    { name: "Bridal Make-up", description: "Bridal make-up with hair", price: 3500, durationMinutes: 180 },
    { name: "Hair Coloring", description: "Single-process hair coloring", price: 1200, durationMinutes: 120 },
    { name: "Manicure", description: "Basic manicure", price: 200, durationMinutes: 30 },
    { name: "Pedicure", description: "Basic pedicure", price: 250, durationMinutes: 45 },
    { name: "Facial", description: "Cleansing facial", price: 500, durationMinutes: 60 },
];

const WEEKDAY_HOURS: SeedSchedule[] = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    startTime: "09:00:00",
    endTime: "18:00:00",
}));

const STAFF: SeedStaff[] = [
    {
        username: "staff.maria",
        email: "maria@raheemsalon.local",
        firstName: "Maria",
        lastName: "Santos",
        position: "Senior Stylist",
        phone: "09170000001",
        schedules: WEEKDAY_HOURS,
        services: ["Haircut", "Hair Styling", "Hair Coloring", "Manicure", "Pedicure"],
    },
    {
        username: "staff.ana",
        email: "ana@raheemsalon.local",
        firstName: "Ana",
        lastName: "Reyes",
        position: "Make-up Artist",
        phone: "09170000002",
        schedules: WEEKDAY_HOURS,
        services: ["Make-up", "Bridal Make-up", "Facial"],
    },
];

const hash = (plain: string): string => bcrypt.hashSync(plain, BCRYPT_ROUNDS);

const upsertUser = async (
    connection: Connection,
    user: { username: string; email: string; password: string; role: "owner" | "staff" }
): Promise<number> => {
    const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM users WHERE username = ?",
        [user.username]
    );

    if (rows.length > 0) {
        const id = rows[0]!.id as number;
        await connection.execute(
            "UPDATE users SET email = ?, password = ?, role = ?, is_active = 1 WHERE id = ?",
            [user.email, hash(user.password), user.role, id]
        );
        return id;
    }

    const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO users (username, email, password, role, is_active) VALUES (?, ?, ?, ?, 1)",
        [user.username, user.email, hash(user.password), user.role]
    );
    return result.insertId;
};

const upsertService = async (
    connection: Connection,
    service: SeedService
): Promise<number> => {
    const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM services WHERE name = ?",
        [service.name]
    );

    if (rows.length > 0) {
        const id = rows[0]!.id as number;
        await connection.execute(
            "UPDATE services SET description = ?, price = ?, duration_minutes = ?, is_active = 1 WHERE id = ?",
            [service.description, service.price, service.durationMinutes, id]
        );
        return id;
    }

    const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO services (name, description, price, duration_minutes, is_active) VALUES (?, ?, ?, ?, 1)",
        [service.name, service.description, service.price, service.durationMinutes]
    );
    return result.insertId;
};

const upsertStaff = async (
    connection: Connection,
    userId: number,
    staff: SeedStaff
): Promise<number> => {
    const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM staff WHERE user_id = ?",
        [userId]
    );

    if (rows.length > 0) {
        const id = rows[0]!.id as number;
        await connection.execute(
            "UPDATE staff SET first_name = ?, last_name = ?, position = ?, phone = ?, email = ?, is_active = 1 WHERE id = ?",
            [staff.firstName, staff.lastName, staff.position, staff.phone, staff.email, id]
        );
        return id;
    }

    const [result] = await connection.execute<ResultSetHeader>(
        "INSERT INTO staff (user_id, first_name, last_name, position, phone, email, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
        [userId, staff.firstName, staff.lastName, staff.position, staff.phone, staff.email]
    );
    return result.insertId;
};

const upsertSchedule = async (
    connection: Connection,
    staffId: number,
    schedule: SeedSchedule
): Promise<void> => {
    await connection.execute(
        `INSERT INTO staff_schedules (staff_id, weekday, start_time, end_time, is_active)
         VALUES (?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE end_time = VALUES(end_time), is_active = 1`,
        [staffId, schedule.weekday, schedule.startTime, schedule.endTime]
    );
};

const assignService = async (
    connection: Connection,
    staffId: number,
    serviceId: number
): Promise<void> => {
    await connection.execute(
        `INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE service_id = VALUES(service_id)`,
        [staffId, serviceId]
    );
};

export const runSeed = async (): Promise<void> => {
    const connection = await createConnection({
        host: required("DB_HOST"),
        user: required("DB_USER"),
        password: required("DB_PASSWORD"),
        database: required("DB_NAME"),
        port: Number(required("DB_PORT")),
        multipleStatements: false,
    });

    try {
        const ownerUsername = process.env.SEED_OWNER_USERNAME ?? "owner";
        const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@raheemsalon.local";

        const ownerId = await upsertUser(connection, {
            username: ownerUsername,
            email: ownerEmail,
            password: required("SEED_OWNER_PASSWORD"),
            role: "owner",
        });
        console.log(`Owner ready: ${ownerUsername} (id ${ownerId})`);

        const serviceIds = new Map<string, number>();
        for (const service of SERVICES) {
            const id = await upsertService(connection, service);
            serviceIds.set(service.name, id);
        }
        console.log(`Services ready: ${serviceIds.size}`);

        const staffPassword = required("SEED_STAFF_PASSWORD");
        for (const staff of STAFF) {
            const userId = await upsertUser(connection, {
                username: staff.username,
                email: staff.email,
                password: staffPassword,
                role: "staff",
            });
            const staffId = await upsertStaff(connection, userId, staff);

            for (const schedule of staff.schedules) {
                await upsertSchedule(connection, staffId, schedule);
            }
            for (const serviceName of staff.services) {
                const serviceId = serviceIds.get(serviceName);
                if (serviceId === undefined) {
                    throw new Error(`Unknown service in seed: ${serviceName}`);
                }
                await assignService(connection, staffId, serviceId);
            }
            console.log(`Staff ready: ${staff.firstName} ${staff.lastName} (id ${staffId})`);
        }

        console.log("Seed complete.");
    } finally {
        await connection.end();
    }
};

runIfMain(import.meta.url, "Seed failed:", runSeed);
