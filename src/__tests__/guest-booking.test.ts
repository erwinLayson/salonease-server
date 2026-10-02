import "dotenv/config";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool, databasePool } from "../config/database.js";
import type { RowDataPacket } from "mysql2/promise";
import { loginWith, send } from "./http.js";
import {
    apiCreateService,
    apiCreateStaff,
    apiSetupBookable,
    atTime,
    dateInDays,
    weekdayOfDate,
} from "./fixtures.js";
import {
    cleanupBookingsFor,
    createTestUser,
    deleteTestUser,
    TEST_PASSWORD,
} from "./helpers.js";
import { resetRateLimits } from "../middleware/rateLimit.js";
import {
    cancelManagedBooking,
    createGuestBooking,
    getManagedBooking,
    requestReschedule,
} from "../service/guestBooking.js";
import { createBooking } from "../service/booking.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let ownerCookie: string | undefined;
let staffId: number;
let serviceId: number;
let targetDate: string;

const PHONE = "09171234567";

const bookBody = (overrides: Record<string, unknown> = {}) => ({
    serviceId,
    staffId,
    startAt: `${targetDate}T10:00:00`,
    firstName: "Guest",
    lastName: "Customer",
    phone: PHONE,
    ...overrides,
});

/** A valid booking created directly through the service (returns the token). */
const seedBooking = async (time: string): Promise<{ token: string; id: number }> => {
    const created = await createBooking({
        customer: { firstName: "Manage", lastName: "Test", phone: "09170001111", email: null },
        staffId,
        serviceId,
        startAt: atTime(targetDate, time),
        source: "online",
    });

    return { token: created.manage_token, id: created.id };
};

const notesOf = async (id: number): Promise<string> => {
    const connection = await databasePool().getConnection();
    try {
        const [rows] = await connection.execute<RowDataPacket[]>(
            "SELECT notes FROM appointments WHERE id = ?",
            [id]
        );
        return String((rows[0] as { notes?: string } | undefined)?.notes ?? "");
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
    const weekday = weekdayOfDate(targetDate);
    const schedules = await send(
        "put",
        `/api/owner/staff/${staffId}/schedules`,
        ownerCookie
    ).send({ blocks: [{ weekday, startTime: "09:00", endTime: "18:00" }] });
    assert.equal(schedules.status, 200);
});

beforeEach(() => {
    resetRateLimits();
});

after(async () => {
    await cleanupBookingsFor([staffId], [serviceId]);
    await send("delete", `/api/owner/staff/${staffId}`, ownerCookie);
    await send("delete", `/api/owner/services/${serviceId}`, ownerCookie);
    await deleteTestUser(owner.id);
    await closeDatabasePool();
});

// ------------------------------------------------------------------ success

test("guest booking with a chosen staff member is saved and returns a manage link", async () => {
    const res = await send("post", "/api/public/bookings").send(bookBody());

    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, "pending");
    assert.equal(res.body.data.serviceName.length > 0, true);
    assert.match(res.body.manageUrl, /\/manage\?token=[0-9a-f]{64}$/);

    const token = new URL(res.body.manageUrl).searchParams.get("token")!;
    const view = await getManagedBooking(token);
    assert.equal(view.reference, res.body.data.reference);
});

test("guest booking with no staffId is assigned to the first available staff", async () => {
    const body = bookBody({ startAt: `${targetDate}T11:00:00` });
    delete (body as Record<string, unknown>).staffId;

    const res = await send("post", "/api/public/bookings").send(body);

    assert.equal(res.status, 201);
    assert.equal(res.body.data.staffName.length > 0, true);
});

// -------------------------------------------------------------- validation

test("missing first name is rejected (400)", async () => {
    const res = await send("post", "/api/public/bookings").send(bookBody({ firstName: "" }));
    assert.equal(res.status, 400);
});

test("missing both phone and email is rejected (400)", async () => {
    const body = bookBody();
    delete (body as Record<string, unknown>).phone;

    const res = await send("post", "/api/public/bookings").send(body);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /phone number or an email/);
});

test("an invalid email is rejected (400)", async () => {
    const res = await send("post", "/api/public/bookings").send(
        bookBody({ phone: null, email: "not-an-email" })
    );
    assert.equal(res.status, 400);
});

test("an invalid phone number is rejected (400)", async () => {
    const res = await send("post", "/api/public/bookings").send(
        bookBody({ phone: "abc" })
    );
    assert.equal(res.status, 400);
});

test("an unknown service is rejected (404)", async () => {
    const res = await send("post", "/api/public/bookings").send(
        bookBody({ serviceId: 99999999 })
    );
    assert.equal(res.status, 404);
});

test("an inactive service is not bookable (404)", async () => {
    const created = await apiCreateService(ownerCookie);
    const inactiveId = created.body.data.id;
    await send("patch", `/api/owner/services/${inactiveId}/status`, ownerCookie).send({
        isActive: false,
    });

    try {
        const res = await send("post", "/api/public/bookings").send(
            bookBody({ serviceId: inactiveId })
        );
        assert.equal(res.status, 404);
    } finally {
        await send("delete", `/api/owner/services/${inactiveId}`, ownerCookie);
    }
});

test("an ineligible staff member is rejected (400)", async () => {
    const other = await apiCreateStaff(ownerCookie);
    try {
        const res = await send("post", "/api/public/bookings").send(
            bookBody({ staffId: other.body.data.id })
        );
        assert.equal(res.status, 400);
    } finally {
        await send("delete", `/api/owner/staff/${other.body.data.id}`, ownerCookie);
    }
});

// ---------------------------------------------------------------- conflicts

test("a conflicting booking is rejected with a clear message and alternatives", async () => {
    await send("post", "/api/public/bookings").send(bookBody({ startAt: `${targetDate}T09:00:00` }));

    const res = await send("post", "/api/public/bookings").send(
        bookBody({ startAt: `${targetDate}T09:00:00` })
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /no longer available|just taken/);
    assert.ok(Array.isArray(res.body.alternatives));
    assert.ok(res.body.alternatives.length > 0);
    assert.ok(!res.body.alternatives.includes("09:00"));
});

// ------------------------------------------------------------ spam control

test("rate limiting blocks abusive booking attempts with 429", async () => {
    // The limiter runs before the handler, so even rejected requests count.
    // The limit is 5 requests per window for the booking endpoint.
    for (let i = 0; i < 5; i += 1) {
        const res = await send("post", "/api/public/bookings").send({});
        assert.equal(res.status, 400, `request ${i + 1} should reach validation`);
    }

    const blocked = await send("post", "/api/public/bookings").send({});

    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers["retry-after"] !== undefined, true);
});

// --------------------------------------------------------------- manage link

test("the manage link returns the booking without exposing the token", async () => {
    const { token } = await seedBooking("13:00");

    const res = await send("get", `/api/public/bookings/${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.canCancel, true);
    assert.equal(res.body.data.manage_token, undefined);
});

test("an unknown or malformed manage token returns 404", async () => {
    const unknown = await send("get", `/api/public/bookings/${"a".repeat(64)}`);
    assert.equal(unknown.status, 404);

    const malformed = await send("get", "/api/public/bookings/not-a-token");
    assert.equal(malformed.status, 404);
});

test("a customer can cancel through the manage link", async () => {
    const { token } = await seedBooking("14:00");

    const res = await send("post", `/api/public/bookings/${token}/cancel`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "cancelled");
    assert.equal(res.body.data.canCancel, false);
});

test("cancelling twice is rejected (409)", async () => {
    const { token } = await seedBooking("14:30");

    const first = await send("post", `/api/public/bookings/${token}/cancel`);
    assert.equal(first.status, 200);

    const second = await send("post", `/api/public/bookings/${token}/cancel`);
    assert.equal(second.status, 409);
});

test("cancelling inside the cutoff window is rejected (409)", async () => {
    const { token } = await seedBooking("16:00");

    // The appointment starts at 16:00; the cutoff is 2 hours before (14:00).
    await assert.rejects(
        () => cancelManagedBooking(token, atTime(targetDate, "14:30")),
        /too late to cancel/
    );

    // Well before the cutoff it succeeds.
    const before = await cancelManagedBooking(token, atTime(targetDate, "09:00"));
    assert.equal(before.status, "cancelled");
});

test("a customer can request rescheduling, which is recorded on the booking", async () => {
    const { token, id } = await seedBooking("15:00");

    const res = await send("post", `/api/public/bookings/${token}/reschedule-request`).send({
        preferredStartAt: `${targetDate}T16:00:00`,
        note: "Running late",
    });

    assert.equal(res.status, 202);
    assert.match(res.body.data.message, /reschedule request has been received/i);

    const notes = await notesOf(id);
    assert.match(notes, /Reschedule requested/);
    assert.match(notes, /Running late/);
});

test("a reschedule request with a past preferred time is rejected (409)", async () => {
    const { token } = await seedBooking("12:00");

    await assert.rejects(
        () =>
            requestReschedule(
                token,
                { preferredStartAt: atTime(targetDate, "09:00"), note: null },
                atTime(targetDate, "12:00")
            ),
        /future/
    );
});

test("rescheduling a cancelled booking is rejected (409)", async () => {
    const { token } = await seedBooking("15:45");
    await cancelManagedBooking(token, atTime(targetDate, "09:00"));

    const res = await send("post", `/api/public/bookings/${token}/reschedule-request`).send({});
    assert.equal(res.status, 409);
});

test("a booked slot disappears from the public availability list", async () => {
    await createGuestBooking({
        serviceId,
        staffId,
        startAt: atTime(targetDate, "17:00"),
        customer: { firstName: "Slot", lastName: null, phone: "09170002222", email: null },
    });

    const res = await send(
        "get",
        `/api/public/availability?serviceId=${serviceId}&date=${targetDate}&staffId=${staffId}`
    );
    assert.equal(res.status, 200);
    assert.ok(!res.body.data.staff[0].slots.includes("17:00"));
});
