import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../config/database.js";
import { loginWith, send } from "./http.js";
import { apiCreateService, uniqueSuffix } from "./fixtures.js";
import { createTestUser, deleteTestUser, TEST_PASSWORD } from "./helpers.js";

// Types
import type { TestUser } from "./helpers.js";

let owner: TestUser;
let staffUser: TestUser;
let ownerCookie: string | undefined;
let staffCookie: string | undefined;

const created: number[] = [];

before(async () => {
    owner = await createTestUser("owner");
    staffUser = await createTestUser("staff");
    ownerCookie = (await loginWith(owner.username, TEST_PASSWORD)).cookie;
    staffCookie = (await loginWith(staffUser.username, TEST_PASSWORD)).cookie;

    assert.ok(ownerCookie && staffCookie);
});

after(async () => {
    for (const id of created) {
        await send("delete", `/api/owner/services/${id}`, ownerCookie);
    }
    await deleteTestUser(owner.id);
    await deleteTestUser(staffUser.id);
    await closeDatabasePool();
});

test("owner creates a service with price and duration", async () => {
    const res = await apiCreateService(ownerCookie, {
        name: `Haircut Test ${uniqueSuffix()}`,
        price: 350.5,
        durationMinutes: 45,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.data.price, 350.5);
    assert.equal(res.body.data.duration_minutes, 45);
    assert.equal(res.body.data.is_active, 1);
    created.push(res.body.data.id);
});

test("service price must be >= 0", async () => {
    const res = await apiCreateService(ownerCookie, { price: -1 });
    assert.equal(res.status, 400);
});

test("service duration must be greater than 0", async () => {
    const res = await apiCreateService(ownerCookie, { durationMinutes: 0 });
    assert.equal(res.status, 400);
});

test("service duration must align to the slot granularity (15 min)", async () => {
    const res = await apiCreateService(ownerCookie, { durationMinutes: 20 });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /multiple of 15/);
});

test("duplicate service name is rejected with 409", async () => {
    const name = `Duplicate Test ${uniqueSuffix()}`;
    const first = await apiCreateService(ownerCookie, { name });
    created.push(first.body.data.id);

    const second = await apiCreateService(ownerCookie, { name });
    assert.equal(second.status, 409);
});

test("owner reads, updates, and toggles a service", async () => {
    const createRes = await apiCreateService(ownerCookie, { name: `Facial Test ${uniqueSuffix()}` });
    const id = createRes.body.data.id;
    created.push(id);

    const getRes = await send("get", `/api/owner/services/${id}`, ownerCookie);
    assert.equal(getRes.status, 200);

    const updateRes = await send("put", `/api/owner/services/${id}`, ownerCookie).send({
        name: `Facial Test Updated ${uniqueSuffix()}`,
        description: "updated",
        price: 500,
        durationMinutes: 60,
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.price, 500);
    assert.equal(updateRes.body.data.duration_minutes, 60);

    const deactivate = await send("patch", `/api/owner/services/${id}/status`, ownerCookie).send({
        isActive: false,
    });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.data.is_active, 0);
});

test("inactive services are hidden from the default list but shown with includeInactive", async () => {
    const createRes = await apiCreateService(ownerCookie, { name: `Hidden Test ${uniqueSuffix()}` });
    const id = createRes.body.data.id;
    created.push(id);

    await send("patch", `/api/owner/services/${id}/status`, ownerCookie).send({ isActive: false });

    const activeList = await send("get", "/api/owner/services", ownerCookie);
    assert.ok(!activeList.body.data.some((s: { id: number }) => s.id === id));

    const fullList = await send("get", "/api/owner/services?includeInactive=true", ownerCookie);
    assert.ok(fullList.body.data.some((s: { id: number }) => s.id === id));
});

test("owner deletes a service with no appointments", async () => {
    const createRes = await apiCreateService(ownerCookie, { name: `Deletable ${uniqueSuffix()}` });
    const id = createRes.body.data.id;

    const res = await send("delete", `/api/owner/services/${id}`, ownerCookie);
    assert.equal(res.status, 204);

    const getRes = await send("get", `/api/owner/services/${id}`, ownerCookie);
    assert.equal(getRes.status, 404);
});

test("unknown service id returns 404", async () => {
    const res = await send("get", "/api/owner/services/99999999", ownerCookie);
    assert.equal(res.status, 404);
});

test("invalid service id returns 400", async () => {
    const res = await send("get", "/api/owner/services/abc", ownerCookie);
    assert.equal(res.status, 400);
});

test("staff role cannot manage services (403)", async () => {
    const list = await send("get", "/api/owner/services", staffCookie);
    assert.equal(list.status, 403);

    const create = await apiCreateService(staffCookie);
    assert.equal(create.status, 403);
});
