import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
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

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let ownerCookie: string | undefined;
let staffCookie: string | undefined;

let staffId: number;
let serviceId: number;
/** Covered by the main request — inside the 30-day booking window. */
let leaveDate: string;
/** A second working day used to approve then undo a leave. */
let undoDate: string;
/** The main pending request, submitted by the staff member. */
let mainRequestId: number;

/** Bookable slots (or lack of them) for the staff member on a date. */
const slotsOn = async (
    date: string
): Promise<{ slots: string[]; status: string; reason: string | null }> => {
    const res = await send(
        "get",
        `/api/public/availability?serviceId=${serviceId}&date=${date}&staffId=${staffId}`
    );
    assert.equal(res.status, 200);
    const entry = res.body.data.staff[0] as
        | { slots: string[]; status: string; reason: string | null }
        | undefined;
    assert.ok(entry, "the staff member must appear in the availability result");
    return entry;
};

const submitRequest = (
    startDate: string,
    endDate: string,
    reason?: string | undefined
) =>
    send("post", "/api/staff/leave-requests", staffCookie).send({
        startDate,
        endDate,
        ...(reason === undefined ? {} : { reason }),
    });

/** `YYYY-MM-DD` (local) for an ISO timestamp returned by the API. */
const localDateKey = (value: string): string => {
    const date = new Date(value);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

before(async () => {
    owner = await createTestUser("owner");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie);

    // A staff member with their own login, so they can submit requests.
    const username = `leave.staff.${uniqueSuffix()}`;
    const created = await apiCreateStaff(ownerCookie, { username, password: TEST_PASSWORD });
    assert.equal(created.status, 201);
    staffId = created.body.data.id;
    staffCookie = (await loginWith(username, TEST_PASSWORD)).cookie;
    assert.ok(staffCookie);

    // A service the staff member offers, so availability can be asserted.
    const service = await apiCreateService(ownerCookie);
    serviceId = service.body.data.id;
    const assigned = await send(
        "put",
        `/api/owner/staff/${staffId}/services`,
        ownerCookie
    ).send({ serviceIds: [serviceId] });
    assert.equal(assigned.status, 200);

    leaveDate = dateInDays(20);
    undoDate = dateInDays(24);
    const weekdays = [...new Set([weekdayOfDate(leaveDate), weekdayOfDate(undoDate)])];
    const schedules = await send(
        "put",
        `/api/owner/staff/${staffId}/schedules`,
        ownerCookie
    ).send({
        blocks: weekdays.map((weekday) => ({ weekday, startTime: "09:00", endTime: "18:00" })),
    });
    assert.equal(schedules.status, 200);
});

after(async () => {
    await cleanupBookingsFor([staffId], [serviceId]);
    // Deleting the staff member cascades to their leave requests and to the
    // schedule_exceptions rows their approvals created.
    await send("delete", `/api/owner/staff/${staffId}`, ownerCookie);
    await send("delete", `/api/owner/services/${serviceId}`, ownerCookie);
    await deleteTestUser(owner.id);
    await closeDatabasePool();
});

test("staff submits a leave request that starts as pending", async () => {
    const res = await submitRequest(leaveDate, leaveDate, "Family matter");

    assert.equal(res.status, 201);
    mainRequestId = res.body.data.id;
    assert.equal(res.body.data.status, "pending");
    assert.equal(res.body.data.staffId, staffId);
    assert.equal(res.body.data.startDate, leaveDate);
    assert.equal(res.body.data.endDate, leaveDate);
    assert.equal(res.body.data.days, 1);
    assert.equal(res.body.data.reason, "Family matter");
    assert.equal(res.body.data.decidedAt, null);
});

test("the request shows up for the staff member and the owner", async () => {
    const mine = await send("get", "/api/staff/leave-requests", staffCookie);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.some((row: { id: number }) => row.id === mainRequestId));

    const all = await send("get", "/api/owner/leave-requests", ownerCookie);
    assert.equal(all.status, 200);
    const row = all.body.data.find((entry: { id: number }) => entry.id === mainRequestId);
    assert.ok(row, "the owner must see the request");
    assert.equal(row.status, "pending");
    assert.equal(row.staffId, staffId);
    assert.ok(row.staffName, "the owner sees which staff member asked");
    assert.equal(row.startDate, leaveDate);
    assert.equal(row.days, 1);
    assert.equal(row.reason, "Family matter");
    assert.ok(row.requestedAt, "the request date is included");

    const pending = await send("get", "/api/owner/leave-requests?status=pending", ownerCookie);
    assert.ok(pending.body.data.some((entry: { id: number }) => entry.id === mainRequestId));

    const approved = await send("get", "/api/owner/leave-requests?status=approved", ownerCookie);
    assert.ok(!approved.body.data.some((entry: { id: number }) => entry.id === mainRequestId));
});

test("leave dates in the past are rejected (400)", async () => {
    const res = await submitRequest(dateInDays(-1), dateInDays(-1));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /past/i);
});

test("an end date before the start date is rejected (400)", async () => {
    const res = await submitRequest(dateInDays(30), dateInDays(20));
    assert.equal(res.status, 400);
    assert.match(res.body.message, /on or after/i);
});

test("a pending request does not change availability", async () => {
    const before = await slotsOn(leaveDate);
    assert.ok(before.slots.length > 0, "pending leave must not remove slots");
    assert.equal(before.status, "available");
});

test("the owner sees which appointments a request would affect", async () => {
    // Booked while the request is still pending, through the real walk-in path.
    const created = await send("post", "/api/owner/appointments", ownerCookie).send({
        firstName: "Conflict",
        lastName: "Customer",
        phone: "09171112222",
        staffId,
        serviceId,
        startAt: `${leaveDate}T10:00:00`,
    });
    assert.equal(created.status, 201);

    // Confirm it, so the conflict is an active booking either way.
    const confirmed = await send(
        "patch",
        `/api/owner/appointments/${created.body.data.id}/status`,
        ownerCookie
    ).send({ status: "confirmed" });
    assert.equal(confirmed.status, 200);

    const res = await send(
        "get",
        `/api/owner/leave-requests/${mainRequestId}/conflicts`,
        ownerCookie
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, created.body.data.id);
    assert.equal(res.body.data[0].staff.id, staffId);
});

test("approving over existing bookings needs an explicit review (409)", async () => {
    const res = await send(
        "post",
        `/api/owner/leave-requests/${mainRequestId}/approve`,
        ownerCookie
    ).send({});

    assert.equal(res.status, 409);
    assert.equal(res.body.conflicts.length, 1);
    assert.match(res.body.message, /overlap/i);

    // The request is untouched and nothing was silently modified.
    const list = await send("get", "/api/owner/leave-requests", ownerCookie);
    const row = list.body.data.find((entry: { id: number }) => entry.id === mainRequestId);
    assert.equal(row.status, "pending");

    const appointment = await send(
        "get",
        `/api/owner/appointments/${res.body.conflicts[0].id}`,
        ownerCookie
    );
    assert.equal(appointment.status, 200);
    assert.equal(appointment.body.data.status, "confirmed");
});

test("a staff session cannot approve leave or read the owner's queue (403)", async () => {
    const approve = await send(
        "post",
        `/api/owner/leave-requests/${mainRequestId}/approve`,
        staffCookie
    ).send({});
    assert.equal(approve.status, 403);

    const list = await send("get", "/api/owner/leave-requests", staffCookie);
    assert.equal(list.status, 403);
});

test("the owner approves after reviewing the conflicts", async () => {
    const res = await send(
        "post",
        `/api/owner/leave-requests/${mainRequestId}/approve`,
        ownerCookie
    ).send({ force: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "approved");
    assert.ok(res.body.data.decidedAt, "the decision timestamp is recorded");

    // Approval materialises a blocking leave exception for that day.
    const exceptions = await send(
        "get",
        `/api/owner/schedule-exceptions?staffId=${staffId}`,
        ownerCookie
    );
    assert.equal(exceptions.status, 200);
    const leave = exceptions.body.data.find(
        (row: { type: string; start_at: string }) =>
            row.type === "leave" && localDateKey(row.start_at) === leaveDate
    );
    assert.ok(leave, "an approved leave must block the requested dates");

    // ...and the affected appointment was left exactly as it was.
    const conflicts = await send(
        "get",
        `/api/owner/leave-requests/${mainRequestId}/conflicts`,
        ownerCookie
    );
    assert.equal(conflicts.body.data.length, 1);
    assert.equal(conflicts.body.data[0].status, "confirmed");
});

test("approved leave removes availability and blocks walk-in bookings", async () => {
    const unavailable = await slotsOn(leaveDate);
    assert.equal(unavailable.slots.length, 0, "approved leave must remove every slot");
    assert.equal(unavailable.status, "unavailable");
    assert.match(unavailable.reason ?? "", /leave/i);

    const walkIn = await send("post", "/api/owner/appointments", ownerCookie).send({
        firstName: "Walk-In",
        phone: "09170000001",
        staffId,
        serviceId,
        startAt: `${leaveDate}T14:00:00`,
    });
    assert.equal(walkIn.status, 409, "the owner cannot book a walk-in during approved leave");
});

test("an overlapping approved leave cannot be requested or approved", async () => {
    // Two overlapping requests submitted while neither is approved yet.
    const first = await submitRequest(dateInDays(27), dateInDays(27));
    assert.equal(first.status, 201);
    const second = await submitRequest(dateInDays(27), dateInDays(28));
    assert.equal(second.status, 201);

    // The first approval succeeds...
    const approveFirst = await send(
        "post",
        `/api/owner/leave-requests/${first.body.data.id}/approve`,
        ownerCookie
    ).send({});
    assert.equal(approveFirst.status, 200);

    // ...so the second can no longer be approved.
    const approveSecond = await send(
        "post",
        `/api/owner/leave-requests/${second.body.data.id}/approve`,
        ownerCookie
    ).send({});
    assert.equal(approveSecond.status, 409);
    assert.match(approveSecond.body.message, /already has approved leave/i);

    // And a brand-new request over those dates is refused up front.
    const third = await submitRequest(dateInDays(27), dateInDays(27));
    assert.equal(third.status, 409);
    assert.match(third.body.message, /already have approved leave/i);

    // Clean up so later assertions only see the one approved request.
    const reject = await send(
        "post",
        `/api/owner/leave-requests/${second.body.data.id}/reject`,
        ownerCookie
    ).send({ reason: "Overlaps an approved leave" });
    assert.equal(reject.status, 200);
    assert.equal(reject.body.data.status, "rejected");

    const undo = await send(
        "post",
        `/api/owner/leave-requests/${first.body.data.id}/cancel`,
        ownerCookie
    ).send({});
    assert.equal(undo.status, 200);
});

test("the owner rejects a pending request with an optional reason", async () => {
    const created = await submitRequest(dateInDays(25), dateInDays(25), "Short notice");
    assert.equal(created.status, 201);
    const id = created.body.data.id;

    const res = await send("post", `/api/owner/leave-requests/${id}/reject`, ownerCookie).send({
        reason: "Busy season",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "rejected");
    assert.equal(res.body.data.decisionNote, "Busy season");

    // A rejected request is terminal.
    const approve = await send("post", `/api/owner/leave-requests/${id}/approve`, ownerCookie).send(
        {}
    );
    assert.equal(approve.status, 409);

    // The staff member sees the outcome on their own list.
    const mine = await send("get", "/api/staff/leave-requests", staffCookie);
    const row = mine.body.data.find((entry: { id: number }) => entry.id === id);
    assert.equal(row.status, "rejected");
    assert.equal(row.decisionNote, "Busy season");
});

test("the staff member withdraws their own pending request", async () => {
    const created = await submitRequest(dateInDays(26), dateInDays(26));
    assert.equal(created.status, 201);
    const id = created.body.data.id;

    const res = await send("patch", `/api/staff/leave-requests/${id}/cancel`, staffCookie).send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "cancelled");

    const again = await send("patch", `/api/staff/leave-requests/${id}/cancel`, staffCookie).send(
        {}
    );
    assert.equal(again.status, 409, "a cancelled request is terminal");
});

test("the owner cancels approved leave and the dates open up again", async () => {
    const created = await submitRequest(undoDate, undoDate);
    assert.equal(created.status, 201);
    const id = created.body.data.id;

    const approve = await send("post", `/api/owner/leave-requests/${id}/approve`, ownerCookie).send(
        {}
    );
    assert.equal(approve.status, 200);
    assert.equal(approve.body.data.status, "approved");

    const blocked = await slotsOn(undoDate);
    assert.equal(blocked.slots.length, 0);

    const cancel = await send("post", `/api/owner/leave-requests/${id}/cancel`, ownerCookie).send({
        reason: "Schedule changed",
    });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.data.status, "cancelled");

    const reopened = await slotsOn(undoDate);
    assert.ok(reopened.slots.length > 0, "cancelling approved leave restores availability");

    const exceptions = await send(
        "get",
        `/api/owner/schedule-exceptions?staffId=${staffId}`,
        ownerCookie
    );
    const stillBlocked = exceptions.body.data.some(
        (row: { type: string; start_at: string }) =>
            row.type === "leave" && localDateKey(row.start_at) === undoDate
    );
    assert.ok(!stillBlocked, "the blocking exception must be removed on cancel");
});

test("coverage lists pending and approved leave for every staff in a range", async () => {
    // A colleague with their own login, so two staff members overlap.
    const colleagueUsername = `leave.colleague.${uniqueSuffix()}`;
    const colleague = await apiCreateStaff(ownerCookie, {
        username: colleagueUsername,
        password: TEST_PASSWORD,
    });
    assert.equal(colleague.status, 201);
    const colleagueId = colleague.body.data.id as number;
    const colleagueCookie = (await loginWith(colleagueUsername, TEST_PASSWORD)).cookie;
    assert.ok(colleagueCookie);

    // A fresh window, far from every other date this file uses.
    const start = dateInDays(40);

    // The caller's own request stays pending...
    const mine = await submitRequest(start, dateInDays(41));
    assert.equal(mine.status, 201);

    // ...the colleague's is approved by the owner...
    const theirs = await send("post", "/api/staff/leave-requests", colleagueCookie).send({
        startDate: dateInDays(42),
        endDate: dateInDays(43),
        reason: "Out of town",
    });
    assert.equal(theirs.status, 201);
    const approve = await send(
        "post",
        `/api/owner/leave-requests/${theirs.body.data.id}/approve`,
        ownerCookie
    ).send({});
    assert.equal(approve.status, 200);

    // ...and a third one from them is rejected — settled requests must
    // never tint anyone's calendar.
    const rejected = await send("post", "/api/staff/leave-requests", colleagueCookie).send({
        startDate: start,
        endDate: start,
    });
    assert.equal(rejected.status, 201);
    const reject = await send(
        "post",
        `/api/owner/leave-requests/${rejected.body.data.id}/reject`,
        ownerCookie
    ).send({ reason: "Coverage is fine" });
    assert.equal(reject.status, 200);

    const res = await send(
        "get",
        `/api/staff/leave-requests/coverage?from=${start}&to=${dateInDays(43)}`,
        staffCookie
    );
    assert.equal(res.status, 200);

    const pending = res.body.data.find((row: { id: number }) => row.id === mine.body.data.id);
    const approved = res.body.data.find((row: { id: number }) => row.id === theirs.body.data.id);
    assert.ok(pending, "the caller's own pending request is part of the coverage");
    assert.equal(pending.status, "pending");
    assert.equal(pending.staffId, staffId);
    assert.ok(approved, "the colleague's approved leave is part of the coverage");
    assert.equal(approved.status, "approved");
    assert.equal(approved.staffId, colleagueId);
    assert.ok(approved.staffName, "the colleague's name is included");
    assert.equal(approved.startDate, dateInDays(42));
    assert.equal(approved.reason, undefined, "coverage never exposes reasons");

    assert.ok(
        !res.body.data.some((row: { id: number }) => row.id === rejected.body.data.id),
        "rejected requests are excluded from the coverage"
    );

    // An unrelated range comes back empty.
    const empty = await send(
        "get",
        `/api/staff/leave-requests/coverage?from=${dateInDays(60)}&to=${dateInDays(61)}`,
        staffCookie
    );
    assert.equal(empty.status, 200);
    assert.equal(empty.body.data.length, 0);

    // The owner cannot read the staff-only overlay (403)...
    const asOwner = await send("get", "/api/staff/leave-requests/coverage", ownerCookie);
    assert.equal(asOwner.status, 403);

    // ...a reversed range is a 400, and a bare request still answers
    // with the current month (it is registered as a role-checked GET).
    const reversed = await send(
        "get",
        `/api/staff/leave-requests/coverage?from=${dateInDays(45)}&to=${start}`,
        staffCookie
    );
    assert.equal(reversed.status, 400);

    const bare = await send("get", "/api/staff/leave-requests/coverage", staffCookie);
    assert.equal(bare.status, 200);
    assert.ok(Array.isArray(bare.body.data));

    // Clean the colleague up so only this file's own staff member remains.
    const removed = await send("delete", `/api/owner/staff/${colleagueId}`, ownerCookie);
    assert.equal(removed.status, 204);
});
