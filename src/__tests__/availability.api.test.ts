import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import {
    apiCreateStaff,
    apiSetupBookable,
    atTime,
    dateInDays,
    weekdayOfDate,
} from "./fixtures.js";
import {
    cleanupBookingsFor,
    cleanupTestAppointments,
    createTestUser,
    deleteTestUser,
    insertTestAppointmentAt,
    TEST_PASSWORD,
} from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let staffUser: TestUser;
let ownerCookie: string | undefined;
let staffCookie: string | undefined;

let eligibleStaffId: number;
let ineligibleStaffId: number;
let serviceId: number;
let targetDate: string;
const createdExceptionIds: number[] = [];

const slotsFor = async (staffId: number | null = null): Promise<string[]> => {
    const staffQuery = staffId === null ? "" : `&staffId=${staffId}`;
    const res = await send(
        "get",
        `/api/public/availability?serviceId=${serviceId}&date=${targetDate}${staffQuery}`,
        undefined
    );
    assert.equal(res.status, 200);
    const entry = res.body.data.staff[0] as { slots: string[] };
    return entry?.slots ?? [];
};

before(async () => {
    owner = await createTestUser("owner");
    staffUser = await createTestUser("staff");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    staffCookie = (await loginWith(staffUser.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie && staffCookie);

    const bookable = await apiSetupBookable(ownerCookie, { durationMinutes: 30 });
    eligibleStaffId = bookable.staffId;
    serviceId = bookable.serviceId;

    // A second staff member who is NOT assigned the service.
    const ineligible = await apiCreateStaff(ownerCookie);
    ineligibleStaffId = ineligible.body.data.id;

    // Give the eligible (but not the ineligible) staff member hours on the target day.
    targetDate = dateInDays(14);
    const weekday = weekdayOfDate(targetDate);

    const schedules = await send(
        "put",
        `/api/owner/staff/${eligibleStaffId}/schedules`,
        ownerCookie
    ).send({ blocks: [{ weekday, startTime: "09:00", endTime: "18:00" }] });
    assert.equal(schedules.status, 200);
});

after(async () => {
    await cleanupTestAppointments();
    await cleanupBookingsFor([eligibleStaffId], [serviceId]);
    for (const id of createdExceptionIds) {
        await send("delete", `/api/owner/schedule-exceptions/${id}`, ownerCookie);
    }
    await send("delete", `/api/owner/staff/${eligibleStaffId}`, ownerCookie);
    await send("delete", `/api/owner/staff/${ineligibleStaffId}`, ownerCookie);
    await send("delete", `/api/owner/services/${serviceId}`, ownerCookie);
    await deleteTestUser(owner.id);
    await deleteTestUser(staffUser.id);
    await closeDatabasePool();
});

test("public services list returns active services", async () => {
    const res = await send("get", "/api/public/services");
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((s: { id: number }) => s.id === serviceId));
});

test("public staff list includes only eligible staff", async () => {
    const res = await send("get", `/api/public/staff?serviceId=${serviceId}`);
    assert.equal(res.status, 200);

    const ids = res.body.data.map((s: { staffId: number }) => s.staffId);
    assert.ok(ids.includes(eligibleStaffId));
    assert.ok(!ids.includes(ineligibleStaffId));
});

test("availability returns aligned slots inside working hours", async () => {
    const slots = await slotsFor(eligibleStaffId);
    assert.equal(slots[0], "09:00");
    assert.ok(slots.includes("09:15"));
    // Working day ends at 18:00; a 30-min service must start by 17:30.
    assert.ok(slots.includes("17:30"));
    assert.ok(!slots.includes("17:45"));
});

test("inactive staff are excluded from slots", async () => {
    const deactivate = await send(
        "patch",
        `/api/owner/staff/${eligibleStaffId}/status`,
        ownerCookie
    ).send({ isActive: false });
    assert.equal(deactivate.status, 200);

    const list = await send("get", `/api/public/staff?serviceId=${serviceId}`);
    assert.ok(!list.body.data.some((s: { staffId: number }) => s.staffId === eligibleStaffId));

    const availability = await send(
        "get",
        `/api/public/availability?serviceId=${serviceId}&date=${targetDate}`
    );
    assert.equal(availability.body.data.staff.length, 0);

    // Restore for the remaining tests.
    const reactivate = await send(
        "patch",
        `/api/owner/staff/${eligibleStaffId}/status`,
        ownerCookie
    ).send({ isActive: true });
    assert.equal(reactivate.status, 200);
});

test("a day with no working hours yields no slots", async () => {
    const emptyDay = dateInDays(15);
    if (weekdayOfDate(emptyDay) === weekdayOfDate(targetDate)) {
        return; // same weekday would have hours; skip this occurrence
    }

    const res = await send(
        "get",
        `/api/public/availability?serviceId=${serviceId}&date=${emptyDay}`
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.staff[0]?.slots.length ?? 0, 0);
});

test("an existing appointment removes the slots it occupies (buffer respected)", async () => {
    // 09:00 appointment for a 30-min service occupies [09:00, 09:40) incl. buffer.
    await insertTestAppointmentAt({
        staffId: eligibleStaffId,
        serviceId,
        startAt: atTime(targetDate, "09:00"),
        durationMinutes: 30,
    });

    const slots = await slotsFor(eligibleStaffId);
    assert.ok(!slots.includes("09:00"));
    assert.ok(!slots.includes("09:15"));
    assert.ok(!slots.includes("09:30"));
    assert.ok(slots.includes("09:45"));
});

test("staff leave removes the covered slots", async () => {
    const leave = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        staffId: eligibleStaffId,
        type: "leave",
        startAt: `${targetDate}T11:00:00`,
        endAt: `${targetDate}T13:00:00`,
    });
    // Track the id before asserting: if the assertion fails, after() must
    // still be able to delete the exception it created.
    if (leave.body.data?.id !== undefined) createdExceptionIds.push(leave.body.data.id);
    assert.equal(leave.status, 201);

    const slots = await slotsFor(eligibleStaffId);
    assert.ok(!slots.includes("11:00"));
    assert.ok(!slots.includes("12:45"));
    assert.ok(slots.includes("13:00"));
});

test("month availability marks only working days that have open slots", async () => {
    const month = targetDate.slice(0, 7);
    const res = await send(
        "get",
        `/api/public/availability-month?serviceId=${serviceId}&month=${month}&staffId=${eligibleStaffId}`
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.month, month);

    const dates = res.body.data.staff[0]?.dates as Record<string, number>;
    assert.ok(dates, "staff entry must be present");
    assert.ok(dates[targetDate] !== undefined, "the target day should be marked open");
    assert.ok((dates[targetDate] ?? 0) > 0);

    // The eligible staff member works only one weekday, so no other day may
    // appear — days without working hours must be omitted entirely.
    const expectedWeekday = weekdayOfDate(targetDate);
    for (const key of Object.keys(dates)) {
        assert.equal(weekdayOfDate(key), expectedWeekday, `${key} should be a working day`);
    }
});

test("month availability rejects a bad month and an ineligible staff member", async () => {
    const badMonth = await send(
        "get",
        `/api/public/availability-month?serviceId=${serviceId}&month=2026-13`
    );
    assert.equal(badMonth.status, 400);

    const ineligible = await send(
        "get",
        `/api/public/availability-month?serviceId=${serviceId}&month=${targetDate.slice(0, 7)}&staffId=${ineligibleStaffId}`
    );
    assert.equal(ineligible.status, 400);
});

test("a salon closure removes every slot", async () => {
    // Guarantee an overlapping appointment through the real walk-in path at
    // 09:45 (the buffer test's TST appointment ends at 09:40, so this slot is
    // free regardless of whether it still exists): a `TST*` fixture can be
    // deleted by a concurrent file's after() between an insert and this POST —
    // the closure would then return 201 instead of 409 and leak a full-day
    // closure into the database, poisoning every later run (this actually
    // happened). An `APT-*` booking is untouched by `cleanupTestAppointments`.
    const walkIn = await send("post", "/api/owner/appointments", ownerCookie).send({
        firstName: "Closure",
        lastName: "Conflict",
        phone: "09170000777",
        staffId: eligibleStaffId,
        serviceId,
        startAt: `${targetDate}T09:45:00`,
    });
    // Either we created the booking, or an appointment already overlaps the
    // slot — both mean the conflict check below has something to find.
    assert.ok(
        walkIn.status === 201 ||
            (walkIn.status === 409 && Array.isArray(walkIn.body.conflicts)),
        `walk-in must be created or report a conflict (got ${walkIn.status})`
    );

    // The plain attempt must warn with the conflicting list…
    const warned = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        type: "closure",
        startAt: `${targetDate}T00:00:00`,
        endAt: `${targetDate}T23:59:00`,
    });
    // Track first: if an assertion below fails, after() still deletes it.
    if (warned.status === 201 && warned.body.data?.id !== undefined) {
        createdExceptionIds.push(warned.body.data.id);
    }
    assert.equal(warned.status, 409);
    assert.ok(Array.isArray(warned.body.conflicts));
    assert.ok(warned.body.conflicts.length >= 1);

    // …and force=true creates it anyway (the owner override).
    const closure = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        type: "closure",
        startAt: `${targetDate}T00:00:00`,
        endAt: `${targetDate}T23:59:00`,
        force: true,
    });
    if (closure.body.data?.id !== undefined) createdExceptionIds.push(closure.body.data.id);
    assert.equal(closure.status, 201);

    const slots = await slotsFor(eligibleStaffId);
    assert.deepEqual(slots, []);
});

test("owner availability preview returns 200; staff role is forbidden (403)", async () => {
    const ownerRes = await send(
        "get",
        `/api/owner/availability?serviceId=${serviceId}&date=${targetDate}`,
        ownerCookie
    );
    assert.equal(ownerRes.status, 200);

    const staffRes = await send(
        "get",
        `/api/owner/availability?serviceId=${serviceId}&date=${targetDate}`,
        staffCookie
    );
    assert.equal(staffRes.status, 403);
});

test("availability rejects a bad date and an unknown service", async () => {
    const badDate = await send(
        "get",
        `/api/public/availability?serviceId=${serviceId}&date=2026-13-99`
    );
    assert.equal(badDate.status, 400);

    const unknownService = await send(
        "get",
        `/api/public/availability?serviceId=99999999&date=${targetDate}`
    );
    assert.equal(unknownService.status, 404);
});

test("selecting an ineligible staff member is rejected (400)", async () => {
    const res = await send(
        "get",
        `/api/public/availability?serviceId=${serviceId}&date=${targetDate}&staffId=${ineligibleStaffId}`
    );
    assert.equal(res.status, 400);
});

test("owner availability reports a day-level status and reason", async () => {
    // The same weekday as the configured schedule, so the day has working hours.
    const availableDate = dateInDays(21);
    const available = await send(
        "get",
        `/api/owner/availability?serviceId=${serviceId}&date=${availableDate}&staffId=${eligibleStaffId}`,
        ownerCookie
    );
    assert.equal(available.status, 200);
    const availableEntry = available.body.data.staff[0] as {
        status: string;
        reason: string | null;
    };
    assert.equal(availableEntry.status, "available");
    assert.equal(availableEntry.reason, null);

    // A weekday without working hours is unavailable, with a reason.
    const offDate = dateInDays(22);
    const dayOff = await send(
        "get",
        `/api/owner/availability?serviceId=${serviceId}&date=${offDate}&staffId=${eligibleStaffId}`,
        ownerCookie
    );
    assert.equal(dayOff.status, 200);
    const dayOffEntry = dayOff.body.data.staff[0] as {
        status: string;
        reason: string | null;
    };
    assert.equal(dayOffEntry.status, "unavailable");
    assert.ok(dayOffEntry.reason);

    // A full-day leave blocks the whole working day and carries its reason.
    const leave = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        staffId: eligibleStaffId,
        type: "leave",
        startAt: `${availableDate}T00:00:00`,
        endAt: `${availableDate}T23:59:00`,
        reason: "Vacation",
    });
    if (leave.body.data?.id !== undefined) createdExceptionIds.push(leave.body.data.id);
    assert.equal(leave.status, 201);

    const onLeave = await send(
        "get",
        `/api/owner/availability?serviceId=${serviceId}&date=${availableDate}&staffId=${eligibleStaffId}`,
        ownerCookie
    );
    const onLeaveEntry = onLeave.body.data.staff[0] as {
        status: string;
        reason: string | null;
    };
    assert.equal(onLeaveEntry.status, "unavailable");
    assert.match(onLeaveEntry.reason ?? "", /Vacation/);
});

test("owner service staff list returns only eligible staff with a status", async () => {
    const res = await send(
        "get",
        `/api/owner/services/${serviceId}/staff`,
        ownerCookie
    );
    assert.equal(res.status, 200);

    const ids = res.body.data.map((entry: { staffId: number }) => entry.staffId);
    assert.ok(ids.includes(eligibleStaffId), "eligible staff is included");
    assert.ok(!ids.includes(ineligibleStaffId), "ineligible staff is hidden");

    const entry = res.body.data.find(
        (item: { staffId: number }) => item.staffId === eligibleStaffId
    );
    assert.ok(["available", "busy", "unavailable"].includes(entry.status));
    assert.ok(Array.isArray(entry.schedule));
});
