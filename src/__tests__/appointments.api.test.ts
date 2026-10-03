import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import { apiCreateService, apiCreateStaff, dateInDays, weekdayOfDate } from "./fixtures.js";
import { createTestUser, deleteTestUser, cleanupBookingsFor, TEST_PASSWORD } from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

const STAFF_PASSWORD = "StaffPass2026!";

let owner: TestUser;
let ownerCookie: string | undefined;
let staffACookie: string | undefined;
let staffAUsername: string;

let serviceId: number;
let staffAId: number;
let staffBId: number;

let targetDate: string;

/** Extra services created by tests, cleaned up afterwards. */
const createdServiceIds: number[] = [];

// A phone number unique to this run, so the walk-in customer is never confused
// with a customer created by another (concurrently running) test file.
const CUSTOMER_PHONE = `0917${String(Date.now()).slice(-7)}`;

/** Booked via the owner manual-booking endpoint; reused across tests. */
let appointmentAId: number;
let appointmentAReference: string;

before(async () => {
    owner = await createTestUser("owner");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie);

    serviceId = (await apiCreateService(ownerCookie, { durationMinutes: 30 })).body.data.id;
    createdServiceIds.push(serviceId);

    const staffA = await apiCreateStaff(ownerCookie);
    staffAId = staffA.body.data.id;
    staffAUsername = staffA.body.data.username;
    staffACookie = (await loginWith(staffAUsername, STAFF_PASSWORD)).cookie;
    assert.ok(staffACookie);

    const staffB = await apiCreateStaff(ownerCookie);
    staffBId = staffB.body.data.id;

    // Both staff offer the service.
    for (const id of [staffAId, staffBId]) {
        await send("put", `/api/owner/staff/${id}/services`, ownerCookie).send({
            serviceIds: [serviceId],
        });
    }

    // Working hours on the chosen weekday: 09:00–18:00.
    targetDate = dateInDays(7);
    const weekday = weekdayOfDate(targetDate);
    for (const id of [staffAId, staffBId]) {
        await send("put", `/api/owner/staff/${id}/schedules`, ownerCookie).send({
            blocks: [{ weekday, startTime: "09:00", endTime: "18:00" }],
        });
    }
});

after(async () => {
    await cleanupBookingsFor([staffAId, staffBId], [serviceId]);
    await send("delete", `/api/owner/staff/${staffAId}`, ownerCookie);
    await send("delete", `/api/owner/staff/${staffBId}`, ownerCookie);
    for (const id of createdServiceIds) {
        await send("delete", `/api/owner/services/${id}`, ownerCookie);
    }
    await deleteTestUser(owner.id);
    await closeDatabasePool();
});

/** Creates a manual booking for a given staff member at `HH:mm` on the target date. */
const manualBooking = (staffId: number, time: string, extra: Record<string, unknown> = {}) =>
    send("post", "/api/owner/appointments", ownerCookie).send({
        firstName: "Walk",
        lastName: "In",
        phone: CUSTOMER_PHONE,
        serviceId,
        staffId,
        startAt: `${targetDate}T${time}:00`,
        ...extra,
    });

test("owner creates a manual (walk-in) booking", async () => {
    const res = await manualBooking(staffAId, "09:00");

    assert.equal(res.status, 201);
    appointmentAId = res.body.data.id;
    appointmentAReference = res.body.data.reference;

    assert.equal(res.body.data.source, "manual");
    assert.equal(res.body.data.status, "pending");
    assert.equal(res.body.data.staff.id, staffAId);
    assert.equal(res.body.data.customer.name, "Walk In");
});

test("manual booking outside the staff schedule is rejected (409)", async () => {
    // 07:00 is outside the 09:00–18:00 schedule; the backend enforces the schedule.
    const res = await manualBooking(staffAId, "07:00");
    assert.equal(res.status, 409);
});

test("manual booking on a conflicting time is rejected (409)", async () => {
    const res = await manualBooking(staffAId, "09:00");
    assert.equal(res.status, 409);
});

test("manual booking requires a service, staff member and contact detail", async () => {
    const noContact = await send("post", "/api/owner/appointments", ownerCookie).send({
        firstName: "No",
        serviceId,
        staffId: staffAId,
        startAt: `${targetDate}T16:00:00`,
    });
    assert.equal(noContact.status, 400);

    const noStaff = await send("post", "/api/owner/appointments", ownerCookie).send({
        firstName: "No",
        phone: CUSTOMER_PHONE,
        serviceId,
        startAt: `${targetDate}T16:00:00`,
    });
    assert.equal(noStaff.status, 400);
});

test("owner lists appointments filtered by date and staff", async () => {
    const res = await send(
        "get",
        `/api/owner/appointments?date=${targetDate}&staffId=${staffAId}`,
        ownerCookie
    );

    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((a: { id: number }) => a.id === appointmentAId));
    assert.ok(res.body.data.every((a: { staff: { id: number } }) => a.staff.id === staffAId));
});

test("owner filters appointments by status and searches by reference", async () => {
    const byStatus = await send(
        "get",
        `/api/owner/appointments?date=${targetDate}&status=pending`,
        ownerCookie
    );
    assert.equal(byStatus.status, 200);
    assert.ok(
        byStatus.body.data.every((a: { status: string }) => a.status === "pending")
    );

    const bySearch = await send(
        "get",
        `/api/owner/appointments?search=${appointmentAReference}`,
        ownerCookie
    );
    assert.equal(bySearch.status, 200);
    assert.equal(bySearch.body.data.length, 1);
    assert.equal(bySearch.body.data[0].id, appointmentAId);
});

test("owner reads one appointment; an unknown id returns 404", async () => {
    const get = await send("get", `/api/owner/appointments/${appointmentAId}`, ownerCookie);
    assert.equal(get.status, 200);
    assert.equal(get.body.data.reference, appointmentAReference);

    const missing = await send("get", "/api/owner/appointments/99999999", ownerCookie);
    assert.equal(missing.status, 404);
});

test("status workflow: pending → confirmed → completed (terminal)", async () => {
    const confirm = await send(
        "patch",
        `/api/owner/appointments/${appointmentAId}/status`,
        ownerCookie
    ).send({ status: "confirmed" });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.data.status, "confirmed");

    const complete = await send(
        "patch",
        `/api/owner/appointments/${appointmentAId}/status`,
        ownerCookie
    ).send({ status: "completed" });
    assert.equal(complete.status, 200);
    assert.equal(complete.body.data.status, "completed");

    // Completed is terminal.
    const cancel = await send(
        "patch",
        `/api/owner/appointments/${appointmentAId}/status`,
        ownerCookie
    ).send({ status: "cancelled" });
    assert.equal(cancel.status, 409);
});

test("confirming an already-confirmed appointment is rejected (400)", async () => {
    const created = await manualBooking(staffAId, "13:00");
    const id = created.body.data.id;

    const first = await send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "confirmed",
    });
    assert.equal(first.status, 200);

    const second = await send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "confirmed",
    });
    assert.equal(second.status, 400);
});

test("pending can be cancelled, and a cancelled appointment is terminal (409)", async () => {
    const created = await manualBooking(staffAId, "14:00");
    const id = created.body.data.id;

    const cancel = await send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "cancelled",
        reason: "Customer called to cancel",
    });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.data.status, "cancelled");

    const complete = await send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "completed",
    });
    assert.equal(complete.status, 409);
});

test("a confirmed appointment can be marked as a no-show", async () => {
    const created = await manualBooking(staffAId, "15:00");
    const id = created.body.data.id;

    await send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "confirmed",
    });

    const noShow = await send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "no_show",
    });
    assert.equal(noShow.status, 200);
    assert.equal(noShow.body.data.status, "no_show");
});

test("an invalid status value is rejected (400)", async () => {
    const res = await send(
        "patch",
        `/api/owner/appointments/${appointmentAId}/status`,
        ownerCookie
    ).send({ status: "archived" });
    assert.equal(res.status, 400);
});

test("owner reschedules an appointment to a free slot (200)", async () => {
    const created = await manualBooking(staffBId, "09:00");
    const id = created.body.data.id;

    const res = await send("post", `/api/owner/appointments/${id}/reschedule`, ownerCookie).send({
        startAt: `${targetDate}T10:00:00`,
    });

    assert.equal(res.status, 200);
    assert.equal(new Date(res.body.data.startAt).getHours(), 10);
    assert.equal(res.body.data.staff.id, staffBId);
});

test("rescheduling onto a taken slot is rejected with alternatives (409)", async () => {
    const blocker = await manualBooking(staffBId, "11:00");
    assert.equal(blocker.status, 201);

    const mover = await manualBooking(staffBId, "12:00");
    const id = mover.body.data.id;

    const res = await send("post", `/api/owner/appointments/${id}/reschedule`, ownerCookie).send({
        startAt: `${targetDate}T11:00:00`,
    });

    assert.equal(res.status, 409);
    assert.ok(Array.isArray(res.body.alternatives));
});

test("rescheduling to a time outside working hours is rejected (409)", async () => {
    const created = await manualBooking(staffBId, "13:00");
    const id = created.body.data.id;

    const res = await send("post", `/api/owner/appointments/${id}/reschedule`, ownerCookie).send({
        startAt: `${targetDate}T20:00:00`,
    });

    assert.equal(res.status, 409);
    assert.ok(Array.isArray(res.body.alternatives));
    assert.ok(res.body.alternatives.length > 0);
});

test("a cancelled appointment cannot be rescheduled (409)", async () => {
    const created = await manualBooking(staffBId, "14:00");
    const id = created.body.data.id;

    await send("patch", `/api/owner/appointments/${id}/status`, ownerCookie).send({
        status: "cancelled",
    });

    const res = await send("post", `/api/owner/appointments/${id}/reschedule`, ownerCookie).send({
        startAt: `${targetDate}T15:00:00`,
    });
    assert.equal(res.status, 409);
});

test("owner reschedules to a different staff member", async () => {
    const created = await manualBooking(staffBId, "15:00");
    const id = created.body.data.id;

    const res = await send("post", `/api/owner/appointments/${id}/reschedule`, ownerCookie).send({
        startAt: `${targetDate}T16:00:00`,
        staffId: staffAId,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.staff.id, staffAId);
});

test("owner updates the notes on an appointment", async () => {
    const res = await send(
        "patch",
        `/api/owner/appointments/${appointmentAId}`,
        ownerCookie
    ).send({ notes: "Prefers organic products" });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.notes, "Prefers organic products");
});

test("staff see only their own appointments", async () => {
    // An appointment that belongs to staff B.
    const foreign = await manualBooking(staffBId, "17:00");
    assert.equal(foreign.status, 201);

    const list = await send("get", "/api/staff/appointments", staffACookie);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.length > 0);
    assert.ok(list.body.data.every((a: { staff: { id: number } }) => a.staff.id === staffAId));
    assert.ok(!list.body.data.some((a: { id: number }) => a.id === foreign.body.data.id));

    // A staff member may read their own appointment…
    const own = await send("get", `/api/staff/appointments/${appointmentAId}`, staffACookie);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.staff.id, staffAId);

    // …but another staff member's appointment looks like it does not exist.
    const other = await send(
        "get",
        `/api/staff/appointments/${foreign.body.data.id}`,
        staffACookie
    );
    assert.equal(other.status, 404);
});

test("staff can list appointments for a date range (calendar month)", async () => {
    // A range containing the target date returns the own appointment…
    const inRange = await send(
        "get",
        `/api/staff/appointments?from=${targetDate}&to=${targetDate}`,
        staffACookie
    );
    assert.equal(inRange.status, 200);
    assert.ok(inRange.body.data.every((a: { staff: { id: number } }) => a.staff.id === staffAId));
    assert.ok(inRange.body.data.some((a: { id: number }) => a.id === appointmentAId));

    // …while a range that excludes it comes back empty (month-grid badges).
    const outOfRange = await send(
        "get",
        `/api/staff/appointments?from=${dateInDays(30)}&to=${dateInDays(31)}`,
        staffACookie
    );
    assert.equal(outOfRange.status, 200);
    assert.ok(!outOfRange.body.data.some((a: { id: number }) => a.id === appointmentAId));
});

test("owner daily schedule view lists hours and appointments", async () => {
    const res = await send(
        "get",
        `/api/owner/schedule?view=day&date=${targetDate}`,
        ownerCookie
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.view, "day");
    assert.ok(res.body.data.staff.length >= 2);

    const staffA = res.body.data.staff.find(
        (s: { staffId: number }) => s.staffId === staffAId
    );
    assert.ok(staffA);
    assert.equal(staffA.days.length, 1);
    assert.ok(staffA.days[0].windows.length > 0);
    assert.ok(staffA.days[0].appointments.length > 0);
});

test("owner weekly schedule view covers seven days", async () => {
    const res = await send(
        "get",
        `/api/owner/schedule?view=week&date=${targetDate}`,
        ownerCookie
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.view, "week");
    assert.ok(res.body.data.staff.every((s: { days: unknown[] }) => s.days.length === 7));
});

test("owner monthly schedule view covers the whole month", async () => {
    const [year, month] = targetDate.split("-").map(Number) as [number, number];
    // Month is 1-based, so `new Date(year, month, 0)` is the last day of it.
    const daysInMonth = new Date(year, month, 0).getDate();
    const pad = (value: number) => String(value).padStart(2, "0");

    const res = await send(
        "get",
        `/api/owner/schedule?view=month&date=${targetDate}`,
        ownerCookie
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.view, "month");
    assert.equal(res.body.data.from, `${year}-${pad(month)}-01`);
    assert.equal(res.body.data.to, `${year}-${pad(month)}-${pad(daysInMonth)}`);
    assert.ok(
        res.body.data.staff.every(
            (s: { days: unknown[] }) => s.days.length === daysInMonth
        )
    );
});

test("an invalid schedule view is rejected (400) and an unknown staff is 404", async () => {
    const badView = await send(
        "get",
        `/api/owner/schedule?view=year&date=${targetDate}`,
        ownerCookie
    );
    assert.equal(badView.status, 400);

    const unknownStaff = await send(
        "get",
        `/api/owner/schedule?view=day&date=${targetDate}&staffId=99999999`,
        ownerCookie
    );
    assert.equal(unknownStaff.status, 404);
});

test("staff schedule view is scoped to the signed-in staff member", async () => {
    const res = await send(
        "get",
        `/api/staff/schedule?view=day&date=${targetDate}`,
        staffACookie
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.data.staff.length, 1);
    assert.equal(res.body.data.staff[0].staffId, staffAId);
});

test("owner can reassign an appointment's service (re-checked against availability)", async () => {
    // A second 15-minute service to move to.
    const shortService = await apiCreateService(ownerCookie, { durationMinutes: 15 });
    const shortServiceId = shortService.body.data.id as number;
    createdServiceIds.push(shortServiceId);

    await send("put", `/api/owner/staff/${staffAId}/services`, ownerCookie).send({
        serviceIds: [serviceId, shortServiceId],
    });

    const created = await manualBooking(staffAId, "17:30");
    assert.equal(created.status, 201);
    const id = created.body.data.id as number;

    const res = await send("patch", `/api/owner/appointments/${id}`, ownerCookie).send({
        serviceId: shortServiceId,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.service.id, shortServiceId);
    assert.equal(res.body.data.service.durationMinutes, 15);
});
