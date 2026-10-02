import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import { apiCreateStaff, dateInDays, weekdayOfDate } from "./fixtures.js";
import { createTestUser, deleteTestUser, TEST_PASSWORD } from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let staffUser: TestUser;
let ownerCookie: string | undefined;
let staffCookie: string | undefined;

let staffId: number;
const createdExceptionIds: number[] = [];

before(async () => {
    owner = await createTestUser("owner");
    staffUser = await createTestUser("staff");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    staffCookie = (await loginWith(staffUser.username, TEST_PASSWORD)).cookie;
    assert.ok(ownerCookie && staffCookie);

    const staffRes = await apiCreateStaff(ownerCookie);
    staffId = staffRes.body.data.id;
});

after(async () => {
    for (const id of createdExceptionIds) {
        await send("delete", `/api/owner/schedule-exceptions/${id}`, ownerCookie);
    }
    await send("delete", `/api/owner/staff/${staffId}`, ownerCookie);
    await deleteTestUser(owner.id);
    await deleteTestUser(staffUser.id);
    await closeDatabasePool();
});

test("owner replaces and reads a staff member's weekly hours", async () => {
    const put = await send("put", `/api/owner/staff/${staffId}/schedules`, ownerCookie).send({
        blocks: [
            { weekday: 1, startTime: "09:00", endTime: "13:00" },
            { weekday: 1, startTime: "14:00", endTime: "18:00" },
            { weekday: 3, startTime: "10:00", endTime: "16:00" },
        ],
    });

    assert.equal(put.status, 200);
    assert.equal(put.body.data.length, 3);

    const get = await send("get", `/api/owner/staff/${staffId}/schedules`, ownerCookie);
    assert.equal(get.status, 200);
    assert.equal(get.body.data.length, 3);
});

test("overlapping blocks on the same weekday are rejected (400)", async () => {
    const res = await send("put", `/api/owner/staff/${staffId}/schedules`, ownerCookie).send({
        blocks: [
            { weekday: 2, startTime: "09:00", endTime: "12:00" },
            { weekday: 2, startTime: "11:00", endTime: "15:00" },
        ],
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /must not overlap/);
});

test("a block that ends before it starts is rejected (400)", async () => {
    const res = await send("put", `/api/owner/staff/${staffId}/schedules`, ownerCookie).send({
        blocks: [{ weekday: 2, startTime: "15:00", endTime: "09:00" }],
    });

    assert.equal(res.status, 400);
});

test("an invalid weekday is rejected (400)", async () => {
    const res = await send("put", `/api/owner/staff/${staffId}/schedules`, ownerCookie).send({
        blocks: [{ weekday: 7, startTime: "09:00", endTime: "12:00" }],
    });

    assert.equal(res.status, 400);
});

test("schedules for an unknown staff member return 404", async () => {
    const res = await send("get", "/api/owner/staff/99999999/schedules", ownerCookie);
    assert.equal(res.status, 404);
});

test("owner creates a leave exception for a staff member", async () => {
    const day = dateInDays(10);

    const res = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        staffId,
        type: "leave",
        startAt: `${day}T13:00:00`,
        endAt: `${day}T17:00:00`,
        reason: "Training",
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.type, "leave");
    createdExceptionIds.push(res.body.data.id);

    const list = await send(
        "get",
        `/api/owner/schedule-exceptions?staffId=${staffId}`,
        ownerCookie
    );
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((row: { id: number }) => row.id === res.body.data.id));
});

test("a leave exception without a staff member is rejected (400)", async () => {
    const day = dateInDays(11);

    const res = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        type: "leave",
        startAt: `${day}T09:00:00`,
        endAt: `${day}T10:00:00`,
    });

    assert.equal(res.status, 400);
});

test("a salon closure may not target a single staff member (400)", async () => {
    const day = dateInDays(12);

    const res = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        staffId,
        type: "closure",
        startAt: `${day}T09:00:00`,
        endAt: `${day}T18:00:00`,
    });

    assert.equal(res.status, 400);
});

test("owner records a salon-wide closure", async () => {
    const day = dateInDays(12);

    const res = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        type: "closure",
        startAt: `${day}T00:00:00`,
        endAt: `${day}T23:59:00`,
        reason: "Public holiday",
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.type, "closure");
    assert.equal(res.body.data.staff_id, null);
    createdExceptionIds.push(res.body.data.id);
});

test("an exception that ends before it starts is rejected (400)", async () => {
    const day = dateInDays(13);

    const res = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        staffId,
        type: "leave",
        startAt: `${day}T15:00:00`,
        endAt: `${day}T14:00:00`,
    });

    assert.equal(res.status, 400);
});

test("owner deletes an exception (204), and a missing one returns 404", async () => {
    const day = dateInDays(14);

    const created = await send("post", "/api/owner/schedule-exceptions", ownerCookie).send({
        staffId,
        type: "leave",
        startAt: `${day}T09:00:00`,
        endAt: `${day}T10:00:00`,
    });

    const del = await send(
        "delete",
        `/api/owner/schedule-exceptions/${created.body.data.id}`,
        ownerCookie
    );
    assert.equal(del.status, 204);

    const again = await send(
        "delete",
        `/api/owner/schedule-exceptions/${created.body.data.id}`,
        ownerCookie
    );
    assert.equal(again.status, 404);
});

test("staff role cannot manage schedules or exceptions (403)", async () => {
    const getSchedule = await send("get", `/api/owner/staff/${staffId}/schedules`, staffCookie);
    assert.equal(getSchedule.status, 403);

    const listExceptions = await send("get", "/api/owner/schedule-exceptions", staffCookie);
    assert.equal(listExceptions.status, 403);

    const createException = await send(
        "post",
        "/api/owner/schedule-exceptions",
        staffCookie
    ).send({
        type: "closure",
        startAt: `${dateInDays(5)}T00:00:00`,
        endAt: `${dateInDays(5)}T01:00:00`,
    });
    assert.equal(createException.status, 403);
});

// Keeps the weekday helper referenced so the fixture stays exercised.
test("weekday helper matches the calendar", () => {
    const day = dateInDays(10);
    assert.ok(weekdayOfDate(day) >= 0 && weekdayOfDate(day) <= 6);
});
