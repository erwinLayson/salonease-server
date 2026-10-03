import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool, databasePool } from "../config/database.js";
import type { RowDataPacket } from "mysql2/promise";
import { loginWith, send } from "./http.js";
import { apiSetupBookable, atTime, dateInDays, weekdayOfDate } from "./fixtures.js";
import {
    cleanupBookingsFor,
    cleanupTestAppointments,
    createTestUser,
    deleteTestUser,
    TEST_PASSWORD,
} from "./helpers.js";
import { createBooking } from "../service/booking.js";
import { ConflictError } from "../helper/error.js";

// Types
import type { TestUser } from "./helpers.js";
import type { AppointmentRow } from "../model/appointments.js";

let owner: TestUser;
let ownerCookie: string | undefined;
let staffId: number;
let serviceId: number;
let targetDate: string;

const bookAt = (time: string, phone = "09170001234"): Promise<AppointmentRow> =>
    createBooking({
        customer: { firstName: "Guest", lastName: "Test", phone, email: null },
        staffId,
        serviceId,
        startAt: atTime(targetDate, time),
        source: "online",
    });

const countAt = async (time: string): Promise<number> => {
    const connection = await databasePool().getConnection();
    try {
        const [rows] = await connection.execute<RowDataPacket[]>(
            `SELECT COUNT(*) AS total FROM appointments
             WHERE staff_id = ? AND start_at = ? AND status IN ('pending','confirmed')`,
            [staffId, atTime(targetDate, time)]
        );
        return Number((rows[0] as { total: number } | undefined)?.total ?? 0);
    } finally {
        connection.release();
    }
};

before(async () => {
    owner = await createTestUser("owner");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie);

    const bookable = await apiSetupBookable(ownerCookie, { durationMinutes: 30 });
    staffId = bookable.staffId;
    serviceId = bookable.serviceId;
    targetDate = dateInDays(10);

    // Working hours on the target weekday so the owner manual-booking endpoint
    // (which now enforces the schedule) accepts the test slots.
    await send("put", `/api/owner/staff/${staffId}/schedules`, ownerCookie).send({
        blocks: [{ weekday: weekdayOfDate(targetDate), startTime: "08:00", endTime: "18:00" }],
    });
});

after(async () => {
    await cleanupTestAppointments();
    await cleanupBookingsFor([staffId], [serviceId]);
    await send("delete", `/api/owner/staff/${staffId}`, ownerCookie);
    await send("delete", `/api/owner/services/${serviceId}`, ownerCookie);
    await deleteTestUser(owner.id);
    await closeDatabasePool();
});

test("a valid booking is created as pending with a reference and manage token", async () => {
    const appointment = await bookAt("09:00");

    assert.equal(appointment.status, "pending");
    assert.equal(appointment.reference.length, 12);
    assert.equal(appointment.manage_token.length, 64);
    assert.equal(appointment.price, 100);
});

test("SEQUENTIAL: a second booking for the same slot is rejected", async () => {
    // The first booking at 13:00 succeeds; the duplicate is rejected.
    const first = await createBooking({
        customer: { firstName: "Guest", lastName: "Test", phone: "09170009999", email: null },
        staffId,
        serviceId,
        startAt: atTime(targetDate, "13:00"),
    });
    assert.equal(first.status, "pending");

    await assert.rejects(() => bookAt("13:00"), ConflictError);
    assert.equal(await countAt("13:00"), 1);
});

test("SEQUENTIAL: a booking inside the buffer window is rejected", async () => {
    const first = await createBooking({
        customer: { firstName: "Guest", lastName: "Test", phone: "09170007777", email: null },
        staffId,
        serviceId,
        startAt: atTime(targetDate, "14:00"),
    });
    assert.ok(first.id);

    // 14:00 + 30 min service + 10 min buffer ⇒ the slot is occupied until 14:40.
    await assert.rejects(() => bookAt("14:30"), ConflictError);
    assert.equal(await countAt("14:30"), 0);
});

test("SEQUENTIAL: a booking at the exact buffer boundary is accepted", async () => {
    const first = await createBooking({
        customer: { firstName: "Guest", lastName: "Test", phone: "09170006666", email: null },
        staffId,
        serviceId,
        startAt: atTime(targetDate, "16:00"),
    });
    assert.ok(first.id);

    const next = await bookAt("16:40");
    assert.equal(next.status, "pending");
});

test("CONCURRENT: 5 simultaneous requests for one slot produce exactly 1 booking", async () => {
    const slot = "12:00";

    const results = await Promise.allSettled(
        [1, 2, 3, 4, 5].map((n) => bookAt(slot, `0917000000${n}`))
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactly one concurrent booking must succeed");
    assert.equal(rejected.length, 4, "all other concurrent bookings must be rejected");

    for (const result of rejected) {
        assert.ok(
            (result as PromiseRejectedResult).reason instanceof ConflictError,
            "rejections must be conflicts"
        );
    }

    assert.equal(await countAt(slot), 1, "the database must contain exactly one booking");
});

test("CONCURRENT: owner manual bookings for one slot produce exactly one booking", async () => {
    const slot = "10:30";

    const results = await Promise.all(
        [1, 2, 3, 4, 5].map((n) =>
            send("post", "/api/owner/appointments", ownerCookie).send({
                firstName: "Walk",
                lastName: "In",
                phone: `0917000100${n}`,
                serviceId,
                staffId,
                startAt: `${targetDate}T${slot}:00`,
            })
        )
    );

    const created = results.filter((result) => result.status === 201);
    const conflicts = results.filter((result) => result.status === 409);

    assert.equal(created.length, 1, "exactly one manual booking must succeed");
    assert.equal(conflicts.length, 4, "all other manual bookings must be rejected");
    assert.equal(await countAt(slot), 1, "the database must contain exactly one booking");
});

test("CANCELLING a booking frees the slot for a new booking", async () => {
    const first = await bookAt("15:00");
    await assert.rejects(() => bookAt("15:00"), ConflictError);

    const connection = await databasePool().getConnection();
    try {
        await connection.execute(
            "UPDATE appointments SET status = 'cancelled' WHERE id = ?",
            [first.id]
        );
    } finally {
        connection.release();
    }

    const rebooked = await bookAt("15:00");
    assert.equal(rebooked.status, "pending");
});

test("bookings on the same slot for DIFFERENT staff are independent", async () => {
    // A second eligible staff member at the same time as an existing booking.
    const secondStaff = await send("post", "/api/owner/staff", ownerCookie).send({
        firstName: "Second",
        lastName: "Staff",
        position: "Stylist",
        phone: "09170005555",
        email: "second.staff@example.local",
        username: `test.staff.second.${Date.now()}`,
        password: "StaffPass2026!",
    });
    const secondStaffId = secondStaff.body.data.id;

    try {
        await send("put", `/api/owner/staff/${secondStaffId}/services`, ownerCookie).send({
            serviceIds: [serviceId],
        });

        const appointment = await createBooking({
            customer: { firstName: "Guest", lastName: "Test", phone: "09170004444", email: null },
            staffId: secondStaffId,
            serviceId,
            startAt: atTime(targetDate, "09:00"),
        });

        assert.equal(appointment.staff_id, secondStaffId);
        assert.equal(appointment.status, "pending");
    } finally {
        await cleanupBookingsFor([secondStaffId], []);
        await send("delete", `/api/owner/staff/${secondStaffId}`, ownerCookie);
    }
});
