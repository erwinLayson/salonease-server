import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool, databasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import {
    apiCreateService,
    apiCreateStaff,
    dateInDays,
    uniqueSuffix,
    weekdayOfDate,
} from "./fixtures.js";
import {
    cleanupBookingsFor,
    createTestUser,
    deleteTestUser,
    TEST_PASSWORD,
} from "./helpers.js";
import { resetRateLimits } from "../middleware/rateLimit.js";

import type { TestUser } from "./helpers.js";

const STAFF_PASSWORD = TEST_PASSWORD;
const CUSTOMER_PHONE = `0917${String(Date.now()).slice(-7)}`;

let owner: TestUser;
let ownerCookie: string | undefined;
let staffId: number;
let staffCookie: string | undefined;
let serviceId: number;
let targetDate: string;

/** Clears a closure left by another suite so completion/payment can proceed. */
const reopenToday = async (): Promise<void> => {
    const connection = await databasePool().getConnection();
    try {
        await connection.execute(
            "DELETE FROM daily_sales_closures WHERE business_date = CURDATE()"
        );
    } finally {
        connection.release();
    }
};

const bookBody = (time: string, overrides: Record<string, unknown> = {}) => ({
    serviceId,
    staffId,
    startAt: `${targetDate}T${time}:00`,
    firstName: "E2E",
    lastName: "Guest",
    phone: CUSTOMER_PHONE,
    ...overrides,
});

const tokenOf = (manageUrl: unknown): string => {
    assert.equal(typeof manageUrl, "string");
    const token = new URL(manageUrl as string).searchParams.get("token");
    assert.ok(token, "manage URL must contain a token");
    assert.match(token, /^[0-9a-f]{64}$/);
    return token;
};

before(async () => {
    await reopenToday();
    resetRateLimits();

    owner = await createTestUser("owner");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie);

    const suffix = uniqueSuffix();
    const username = `e2e.staff.${suffix}`;
    const staff = await apiCreateStaff(ownerCookie, {
        username,
        password: STAFF_PASSWORD,
        email: `${username}@example.local`,
    });
    staffId = staff.body.data.id;
    staffCookie = (await loginWith(username, STAFF_PASSWORD)).cookie;
    assert.ok(staffCookie);

    serviceId = (await apiCreateService(ownerCookie, {
        durationMinutes: 30,
        price: 100,
    })).body.data.id;

    await send("put", `/api/owner/staff/${staffId}/services`, ownerCookie).send({
        serviceIds: [serviceId],
    });

    targetDate = dateInDays(10);
    const schedule = await send(
        "put",
        `/api/owner/staff/${staffId}/schedules`,
        ownerCookie
    ).send({
        blocks: [
            {
                weekday: weekdayOfDate(targetDate),
                startTime: "09:00",
                endTime: "18:00",
            },
        ],
    });
    assert.equal(schedule.status, 200);
});

after(async () => {
    await cleanupBookingsFor([staffId], [serviceId]);
    await send("delete", `/api/owner/staff/${staffId}`, ownerCookie);
    await send("delete", `/api/owner/services/${serviceId}`, ownerCookie);
    await deleteTestUser(owner.id);
    await reopenToday();
    await closeDatabasePool();
});

test("guest books → owner confirms → staff completes and settles payment", async (t) => {
    let token = "";
    let reference = "";
    let appointmentId = 0;

    await t.test("customer creates a booking and receives a manage link", async () => {
        const res = await send("post", "/api/public/bookings").send(bookBody("10:00"));
        assert.equal(res.status, 201, JSON.stringify(res.body));
        assert.equal(res.body.data.status, "pending");
        assert.equal(res.body.data.reference.length, 12);
        assert.equal(res.body.data.canCancel, true);
        assert.equal(res.body.data.serviceName.length > 0, true);
        assert.equal(res.body.data.staffName.length > 0, true);
        token = tokenOf(res.body.manageUrl);
        reference = res.body.data.reference;
    });

    await t.test("conflicting slot is rejected with alternatives", async () => {
        const res = await send("post", "/api/public/bookings").send(bookBody("10:00"));
        assert.equal(res.status, 409);
        assert.ok(Array.isArray(res.body.alternatives));
    });

    await t.test("invalid contact details are rejected", async () => {
        const res = await send("post", "/api/public/bookings").send(
            bookBody("13:00", { phone: undefined, email: undefined })
        );
        assert.equal(res.status, 400);
    });

    await t.test("manage link exposes the booking without leaking the token", async () => {
        const res = await send("get", `/api/public/bookings/${token}`);
        assert.equal(res.status, 200);
        assert.equal(res.body.data.reference, reference);
        assert.equal(res.body.data.manage_token, undefined);
        assert.equal(res.body.data.canCancel, true);
    });

    await t.test("customer submits a reschedule request recorded in notes", async () => {
        const res = await send(
            "post",
            `/api/public/bookings/${token}/reschedule-request`
        ).send({
            preferredStartAt: `${targetDate}T11:00:00`,
            note: "Please run a little late",
        });
        assert.equal(res.status, 202, JSON.stringify(res.body));
        assert.match(res.body.data.message, /reschedule request has been received/i);
    });

    await t.test("owner finds the booking and sees the reschedule note", async () => {
        const list = await send(
            "get",
            `/api/owner/appointments?search=${reference}`,
            ownerCookie
        );
        assert.equal(list.status, 200);
        assert.equal(list.body.data.length, 1);
        const found = list.body.data[0];
        appointmentId = found.id;
        assert.equal(found.status, "pending");
        assert.equal(found.source, "online");
        assert.equal(found.staff.id, staffId);

        const detail = await send(
            "get",
            `/api/owner/appointments/${appointmentId}`,
            ownerCookie
        );
        assert.equal(detail.status, 200);
        assert.match(detail.body.data.notes, /Reschedule requested/);
        assert.match(detail.body.data.notes, /Please run a little late/);
    });

    await t.test("owner confirms the booking and customer sees the update", async () => {
        const res = await send(
            "patch",
            `/api/owner/appointments/${appointmentId}/status`,
            ownerCookie
        ).send({ status: "confirmed" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.status, "confirmed");

        const managed = await send("get", `/api/public/bookings/${token}`);
        assert.equal(managed.body.data.status, "confirmed");
    });

    await t.test("appointment appears only on the assigned staff member's pages", async () => {
        const list = await send("get", "/api/staff/appointments", staffCookie);
        assert.equal(list.status, 200);
        assert.equal(
            list.body.data.some((item: { id: number }) => item.id === appointmentId),
            true
        );
        assert.equal(
            list.body.data.every((item: { staff: { id: number } }) => item.staff.id === staffId),
            true
        );

        const detail = await send(
            "get",
            `/api/staff/appointments/${appointmentId}`,
            staffCookie
        );
        assert.equal(detail.status, 200);
        assert.equal(detail.body.data.reference, reference);
    });

    await t.test("staff completes the appointment and a transaction is created", async () => {
        const res = await send(
            "patch",
            `/api/staff/appointments/${appointmentId}/status`,
            staffCookie
        ).send({ status: "completed" });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.data.status, "completed");

        const txn = await send(
            "get",
            `/api/staff/appointments/${appointmentId}/transaction`,
            staffCookie
        );
        assert.equal(txn.status, 200);
        assert.equal(txn.body.data.total, 100);
        assert.equal(txn.body.data.paymentMethod, "cash");
        assert.equal(txn.body.data.paymentStatus, "unpaid");
        assert.equal(txn.body.data.sourceType, "appointment");
    });

    await t.test("staff records payment and the owner sees it", async () => {
        const rejected = await send(
            "patch",
            `/api/staff/appointments/${appointmentId}/transaction`,
            staffCookie
        ).send({ paymentStatus: "waived" });
        assert.equal(rejected.status, 400);

        const paid = await send(
            "patch",
            `/api/staff/appointments/${appointmentId}/transaction`,
            staffCookie
        ).send({ paymentMethod: "gcash", paymentStatus: "paid" });
        assert.equal(paid.status, 200, JSON.stringify(paid.body));
        assert.equal(paid.body.data.paymentMethod, "gcash");
        assert.equal(paid.body.data.paymentStatus, "paid");

        const ownerDetail = await send(
            "get",
            `/api/owner/appointments/${appointmentId}`,
            ownerCookie
        );
        assert.equal(ownerDetail.body.data.paymentStatus, "paid");
    });

    await t.test("customer can cancel a separate booking through the manage link", async () => {
        const created = await send("post", "/api/public/bookings").send(bookBody("12:00"));
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const cancelToken = tokenOf(created.body.manageUrl);

        const cancelled = await send(
            "post",
            `/api/public/bookings/${cancelToken}/cancel`
        );
        assert.equal(cancelled.status, 200);
        assert.equal(cancelled.body.data.status, "cancelled");
        assert.equal(cancelled.body.data.canCancel, false);

        const retry = await send(
            "post",
            `/api/public/bookings/${cancelToken}/cancel`
        );
        assert.equal(retry.status, 409);

        const list = await send(
            "get",
            `/api/owner/appointments?status=cancelled`,
            ownerCookie
        );
        assert.equal(list.status, 200);
        assert.equal(
            list.body.data.some(
                (item: { reference: string }) =>
                    item.reference === cancelled.body.data.reference
            ),
            true
        );
    });
});
