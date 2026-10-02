import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import { apiCreateService, apiCreateStaff, uniqueSuffix } from "./fixtures.js";
import { createTestUser, deleteTestUser, TEST_PASSWORD } from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

const STAFF_PASSWORD = "StaffPass2026!";

/** A 1x1 PNG data URL — a valid avatar payload for the self-service profile. */
const TINY_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let owner: TestUser;
let staffUser: TestUser;
let ownerCookie: string | undefined;
let staffCookie: string | undefined;

const createdStaff: number[] = [];
const createdServices: number[] = [];

before(async () => {
    owner = await createTestUser("owner");
    staffUser = await createTestUser("staff");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    staffCookie = (await loginWith(staffUser.username, TEST_PASSWORD)).cookie;

    assert.ok(ownerCookie && staffCookie);
});

after(async () => {
    for (const id of createdStaff) {
        await send("delete", `/api/owner/staff/${id}`, ownerCookie);
    }
    for (const id of createdServices) {
        await send("delete", `/api/owner/services/${id}`, ownerCookie);
    }
    await deleteTestUser(owner.id);
    await deleteTestUser(staffUser.id);
    await closeDatabasePool();
});

test("owner creates a staff member with a working login account", async () => {
    const res = await apiCreateStaff(ownerCookie, {
        firstName: "Maria",
        lastName: "Cruz",
        username: `test.staff.${uniqueSuffix()}`,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.first_name, "Maria");
    assert.ok(res.body.data.username);
    createdStaff.push(res.body.data.id);

    const login = await loginWith(res.body.data.username, STAFF_PASSWORD);
    assert.equal(login.res.status, 200);
    assert.equal(login.res.body.user.role, "staff");
});

test("duplicate username is rejected with 409", async () => {
    const username = `test.staff.${uniqueSuffix()}`;
    const first = await apiCreateStaff(ownerCookie, { username });
    createdStaff.push(first.body.data.id);

    const second = await apiCreateStaff(ownerCookie, { username });
    assert.equal(second.status, 409);
});

test("short password is rejected with 400", async () => {
    const res = await apiCreateStaff(ownerCookie, { password: "short" });
    assert.equal(res.status, 400);
});

test("owner lists and reads staff", async () => {
    const created = await apiCreateStaff(ownerCookie, { lastName: "Listable" });
    const id = created.body.data.id;
    createdStaff.push(id);

    const list = await send("get", "/api/owner/staff", ownerCookie);
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((s: { id: number }) => s.id === id));

    const get = await send("get", `/api/owner/staff/${id}`, ownerCookie);
    assert.equal(get.status, 200);
    assert.equal(get.body.data.last_name, "Listable");
});

test("owner updates a staff profile and can reset the password", async () => {
    const created = await apiCreateStaff(ownerCookie);
    const id = created.body.data.id;
    const username = created.body.data.username;
    createdStaff.push(id);

    const update = await send("put", `/api/owner/staff/${id}`, ownerCookie).send({
        firstName: "Updated",
        lastName: "Name",
        position: "Senior Stylist",
        phone: "09170000011",
        email: "updated@example.local",
        password: "NewStaffPass2026!",
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.data.first_name, "Updated");
    assert.equal(update.body.data.position, "Senior Stylist");

    const withNewPassword = await loginWith(username, "NewStaffPass2026!");
    assert.equal(withNewPassword.res.status, 200);
});

test("owner assigns services to staff", async () => {
    const staffRes = await apiCreateStaff(ownerCookie);
    const staffId = staffRes.body.data.id;
    createdStaff.push(staffId);

    const svcA = await apiCreateService(ownerCookie);
    const svcB = await apiCreateService(ownerCookie);
    createdServices.push(svcA.body.data.id, svcB.body.data.id);

    const assign = await send("put", `/api/owner/staff/${staffId}/services`, ownerCookie).send({
        serviceIds: [svcA.body.data.id, svcB.body.data.id],
    });
    assert.equal(assign.status, 200);

    const read = await send("get", `/api/owner/staff/${staffId}/services`, ownerCookie);
    assert.equal(read.status, 200);
    assert.deepEqual(
        [...read.body.data.serviceIds].sort((a: number, b: number) => a - b),
        [svcA.body.data.id, svcB.body.data.id].sort((a: number, b: number) => a - b)
    );
});

test("assigning an unknown service id is rejected with 400", async () => {
    const staffRes = await apiCreateStaff(ownerCookie);
    createdStaff.push(staffRes.body.data.id);

    const res = await send(
        "put",
        `/api/owner/staff/${staffRes.body.data.id}/services`,
        ownerCookie
    ).send({ serviceIds: [99999999] });

    assert.equal(res.status, 400);
});

test("owner deletes a staff member with no appointments", async () => {
    const created = await apiCreateStaff(ownerCookie);
    const id = created.body.data.id;
    const username = created.body.data.username;

    const del = await send("delete", `/api/owner/staff/${id}`, ownerCookie);
    assert.equal(del.status, 204);

    // The login account is removed with the profile.
    const login = await loginWith(username, STAFF_PASSWORD);
    assert.equal(login.res.status, 401);
});

test("staff role cannot manage staff (403)", async () => {
    const list = await send("get", "/api/owner/staff", staffCookie);
    assert.equal(list.status, 403);

    const create = await apiCreateStaff(staffCookie);
    assert.equal(create.status, 403);
});

test("staff manage their own personal information", async () => {
    const created = await apiCreateStaff(ownerCookie, {
        firstName: "Self",
        lastName: "Service",
    });
    const id = created.body.data.id as number;
    const username = created.body.data.username as string;
    createdStaff.push(id);

    const cookie = (await loginWith(username, STAFF_PASSWORD)).cookie;
    assert.ok(cookie);

    const before = await send("get", "/api/staff/profile", cookie);
    assert.equal(before.status, 200);
    assert.equal(before.body.data.id, id);
    assert.equal(before.body.data.position, "Stylist");
    assert.equal(before.body.data.profile_photo, null);

    const update = await send("put", "/api/staff/profile", cookie).send({
        firstName: "Updated",
        lastName: "Staff",
        phone: "09171234567",
        email: `self.${uniqueSuffix()}@example.local`,
        address: "123 Sample Street, Manila",
        profilePhoto: TINY_PNG,
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.data.first_name, "Updated");
    assert.equal(update.body.data.address, "123 Sample Street, Manila");
    assert.equal(update.body.data.profile_photo, TINY_PNG);
    // Position is owner-managed and must be untouched by self-service edits.
    assert.equal(update.body.data.position, "Stylist");

    const after = await send("get", "/api/staff/profile", cookie);
    assert.equal(after.body.data.phone, "09171234567");
});

test("staff profile rejects a non-image payload (400)", async () => {
    const created = await apiCreateStaff(ownerCookie);
    createdStaff.push(created.body.data.id);
    const cookie = (
        await loginWith(created.body.data.username as string, STAFF_PASSWORD)
    ).cookie;

    const res = await send("put", "/api/staff/profile", cookie).send({
        firstName: "Updated",
        lastName: "Staff",
        profilePhoto: "data:text/plain;base64,aaaa",
    });
    assert.equal(res.status, 400);
});

test("only staff may use the staff profile endpoint (owner gets 403)", async () => {
    const res = await send("get", "/api/staff/profile", ownerCookie);
    assert.equal(res.status, 403);
});
