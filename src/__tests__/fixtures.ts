import { randomBytes } from "node:crypto";
import { send } from "./http.js";

// Types
import type { Response } from "supertest";

const pad = (value: number): string => String(value).padStart(2, "0");

/** `YYYY-MM-DD` for today + N days (local time). */
export const dateInDays = (days: number): string => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Weekday for a `YYYY-MM-DD` string: 0 = Sunday … 6 = Saturday. */
export const weekdayOfDate = (date: string): number =>
    new Date(`${date}T00:00:00`).getDay();

/** Local Date for a date string + `HH:mm` time. */
export const atTime = (date: string, time: string): Date => new Date(`${date}T${time}:00`);

/** Creates a staff member + service and assigns the service to them. */
export const apiSetupBookable = async (
    cookie: string | undefined,
    options: { durationMinutes?: number } = {}
): Promise<{ staffId: number; serviceId: number }> => {
    const service = await apiCreateService(cookie, {
        durationMinutes: options.durationMinutes ?? 30,
    });
    const staff = await apiCreateStaff(cookie);

    await send("put", `/api/owner/staff/${staff.body.data.id}/services`, cookie).send({
        serviceIds: [service.body.data.id],
    });

    return { staffId: staff.body.data.id, serviceId: service.body.data.id };
};

export const uniqueSuffix = (): string => randomBytes(3).toString("hex");

/** Creates a service through the owner API. */
export const apiCreateService = (
    cookie: string | undefined,
    overrides: Record<string, unknown> = {}
): Promise<Response> =>
    send("post", "/api/owner/services", cookie).send({
        name: `Test Service ${uniqueSuffix()}`,
        description: "Created by the test suite",
        price: 100,
        durationMinutes: 30,
        ...overrides,
    });

/** Creates a staff member through the owner API. */
export const apiCreateStaff = (
    cookie: string | undefined,
    overrides: Record<string, unknown> = {}
): Promise<Response> => {
    const suffix = uniqueSuffix();

    return send("post", "/api/owner/staff", cookie).send({
        firstName: "Test",
        lastName: "Staff",
        position: "Stylist",
        phone: "09170000099",
        email: `test.staff.${suffix}@example.local`,
        username: `test.staff.${suffix}`,
        password: "StaffPass2026!",
        ...overrides,
    });
};
